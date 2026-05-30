import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';
import { registerApiRoute } from '@mastra/core/server';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';
import { createHash } from 'node:crypto';

import { kidsAgent } from './agents/kids-agent.js';
import { zoeAgent } from './agents/zoe-agent.js';
import { maxAgent } from './agents/maxwell-agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../../data/mastra.db');

// Map of agent IDs to Mastra agent names
const AGENT_MAP: Record<string, string> = {
  'ai-buddy': 'kidsAgent',
  'learning-buddy': 'kidsAgent',
  'zoe-agent': 'zoeAgent',
  'zoe': 'zoeAgent',
  'max-agent': 'maxAgent',
  'max': 'maxAgent',
};

/**
 * Derive a stable thread ID from the conversation when no explicit thread_id is provided.
 *
 * Strategy: hash the first user message + model name.
 *
 * Why only the first message?
 *   Home Assistant's Extended OpenAI Conversation sends the full message history on
 *   every request (the array grows with each turn). If we hashed ALL messages, the
 *   thread ID would change mid-conversation, breaking Mastra Memory retrieval.
 *   Hashing just the first message keeps the ID stable for the lifetime of a
 *   conversation.
 *
 * Collision risk:
 *   Two conversations that start with the same first user message AND target the
 *   same agent will share a thread ID, causing their Mastra Memory histories to mix.
 *   In practice this risk is LOW because:
 *     1. Each kid uses a distinct agent (zoe-agent / max-agent), so cross-kid
 *        collisions are impossible — the model name is part of the hash.
 *     2. Voice-initiated queries tend to be unique ("hey jarvis, what time is it",
 *        "play let it go", etc.).
 *     3. Mastra Memory's `lastMessages` window limits any cross-contamination.
 *
 * Proper fix:
 *   If Home Assistant's integration ever exposes its internal `conversation_id` in
 *   the request body, prefer that over this derived hash.
 */
function deriveThreadId(messages: Array<{role: string; content: string}>, model: string): string {
  const firstUserMsg = messages.find(m => m.role === 'user')?.content ?? '';
  return createHash('sha256').update(firstUserMsg + ':' + model).digest('hex').slice(0, 16);
}

/**
 * OpenAI Chat Completions compatible endpoint.
 *
 * Required by Home Assistant's "Extended OpenAI Conversation" integration,
 * which calls client.chat.completions.create() → POST /v1/chat/completions.
 *
 * This route translates the Chat Completions format to Mastra's agent API
 * and back.
 */
const chatCompletionsRoute = registerApiRoute('/v1/chat/completions', {
  method: 'POST',
  handler: async (c) => {
    const body = await c.req.json();

    // --- Parse request ---
    const model: string = body.model ?? 'kids-agent';
    const messages: Array<{ role: string; content: string }> = body.messages ?? [];
    const stream: boolean = body.stream ?? false;
    const maxTokens: number | undefined = body.max_tokens ?? body.max_completion_tokens;
    const temperature: number | undefined = body.temperature;

    // Resolve agent name from model field
    const agentName = AGENT_MAP[model.toLowerCase()] ?? 'kidsAgent';
    const mastra: Mastra = c.get('mastra');

    let agent;
    try {
      agent = await mastra.getAgent(agentName);
    } catch {
      return c.json(
        {
          error: {
            message: `Model '${model}' not found. Available: ${Object.keys(AGENT_MAP).join(', ')}`,
            type: 'invalid_request_error',
          },
        },
        404,
      );
    }

    // Extract the last user message as the primary input
    const userMessages = messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content);
    const lastUserMessage = userMessages[userMessages.length - 1] ?? '';
    const t_start = performance.now();
    console.log(`[agent] request | chars=${lastUserMessage.length} | text=${JSON.stringify(lastUserMessage)}`);

    // Resolve thread ID: use explicit thread_id if provided (e.g., from tests),
    // otherwise derive a stable ID from the first user message + model
    const threadId = (body.thread_id as string | undefined) ?? deriveThreadId(messages, model);
    const resourceId = 'home-assistant';

    // --- Streaming response ---
    if (stream) {
      let streamResult;
      try {
        streamResult = await agent.stream(messages as any, {
          maxSteps: 5,
          memory: { thread: threadId, resource: resourceId },
          ...(maxTokens !== undefined || temperature !== undefined) && {
            modelSettings: {
              ...(maxTokens !== undefined && { maxTokens }),
              ...(temperature !== undefined && { temperature }),
            },
          },
        });
      } catch (err: any) {
        console.error('[agent] stream error:', err?.message ?? err);
        return c.json(
          {
            error: { message: err?.message ?? 'Stream initialization failed', type: 'server_error' },
          },
          500,
        );
      }

      const id = `chatcmpl-${Date.now().toString(36)}`;
      const created = Math.floor(Date.now() / 1000);

      // Convert Mastra stream to SSE in OpenAI Chat Completions format
      const sseStream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();

          const sendChunk = (data: string) => {
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          };

          try {
            let fullText = '';
            for await (const chunk of streamResult.textStream) {
              fullText += chunk;
              sendChunk(
                JSON.stringify({
                  id,
                  object: 'chat.completion.chunk',
                  created,
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: { content: chunk },
                      finish_reason: null,
                    },
                  ],
                }),
              );
            }

            // Empty-response fallback
            if (!fullText || fullText.trim() === '') {
              fullText = 'Hmm, I had trouble with that. Can you try again?';
              sendChunk(
                JSON.stringify({
                  id,
                  object: 'chat.completion.chunk',
                  created,
                  model,
                  choices: [{ index: 0, delta: { content: fullText }, finish_reason: null }],
                }),
              );
            }

            const elapsed = ((performance.now() - t_start) / 1000).toFixed(2);
            console.log(`[agent] response (stream) | elapsed=${elapsed}s | chars=${fullText.length} | text=${JSON.stringify(fullText)}`);

            // Final chunk with finish_reason
            sendChunk(
              JSON.stringify({
                id,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: {},
                    finish_reason: 'stop',
                  },
                ],
              }),
            );

            sendChunk('[DONE]');
          } catch (err: any) {
            sendChunk(
              JSON.stringify({
                error: {
                  message: err.message ?? 'Stream error',
                  type: 'server_error',
                },
              }),
            );
          } finally {
            controller.close();
          }
        },
      });

      return new Response(sseStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    // --- Non-streaming response ---
    let result;
    try {
      result = await agent.generate(messages as any, {
        maxSteps: 5,
        memory: { thread: threadId, resource: resourceId },
        ...(maxTokens !== undefined || temperature !== undefined) && {
          modelSettings: {
            ...(maxTokens !== undefined && { maxTokens }),
            ...(temperature !== undefined && { temperature }),
          },
        },
      });
    } catch (err: any) {
      console.error('[agent] generate error:', err?.message ?? err);
      return c.json(
        {
          error: { message: err?.message ?? 'Generation failed', type: 'server_error' },
        },
        500,
      );
    }
    const responseText = result.text || 'Hmm, I had trouble with that. Can you try again?';
    const elapsed = ((performance.now() - t_start) / 1000).toFixed(2);
    console.log(`[agent] response (generate) | elapsed=${elapsed}s | chars=${responseText.length} | text=${JSON.stringify(responseText)}`);

    const responseId = `chatcmpl-${Date.now().toString(36)}`;
    const created = Math.floor(Date.now() / 1000);

    return c.json({
      id: responseId,
      object: 'chat.completion',
      created,
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: responseText,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: result?.usage?.inputTokens ?? 0,
        completion_tokens: result?.usage?.outputTokens ?? 0,
        total_tokens: result?.usage?.totalTokens ?? 0,
      },
    });
  },
});

/**
 * /v1/models endpoint — lists available models (agents).
 * Required by Extended OpenAI Conversation during setup validation
 * (unless "Skip Authentication" is enabled).
 */
const modelsRoute = registerApiRoute('/v1/models', {
  method: 'GET',
  handler: async (c) => {
    return c.json({
      object: 'list',
      data: Object.entries(AGENT_MAP).map(([id, _agentName]) => ({
        id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'mastra',
      })),
    });
  },
});

export const mastra = new Mastra({
  agents: { kidsAgent, zoeAgent, maxAgent },
  storage: new LibSQLStore({
    id: 'ai-buddy-storage',
    url: `file:${dbPath}`,
  }),
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 4111,
    host: '0.0.0.0',
    apiRoutes: [chatCompletionsRoute, modelsRoute],
  },
});
