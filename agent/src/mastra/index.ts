import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';
import { registerApiRoute } from '@mastra/core/server';
import path from 'path';
import { fileURLToPath } from 'url';

import { kidsAgent } from './agents/kids-agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../../data/mastra.db');

// Map of agent IDs to Mastra agent names
const AGENT_MAP: Record<string, string> = {
  'kids-agent': 'kidsAgent',
  'learning-buddy': 'kidsAgent',
};

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

    // Build thread ID from conversation metadata if provided
    const threadId = body.thread_id as string | undefined;

    // --- Streaming response ---
    if (stream) {
      const streamResult = await agent.stream(lastUserMessage, {
        ...(threadId && { threadId }),
        maxTokens,
        ...(temperature !== undefined && { temperature }),
      });

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
    const result = await agent.generate(lastUserMessage, {
      ...(threadId && { threadId }),
      maxTokens,
      ...(temperature !== undefined && { temperature }),
    });

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
            content: result.text,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: result.usage?.inputTokens ?? 0,
        completion_tokens: result.usage?.outputTokens ?? 0,
        total_tokens: result.usage?.totalTokens ?? 0,
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
  agents: { kidsAgent },
  storage: new LibSQLStore({
    id: 'kids-agent-storage',
    url: `file:${dbPath}`,
  }),
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 4111,
    host: '0.0.0.0',
    apiRoutes: [chatCompletionsRoute, modelsRoute],
  },
});
