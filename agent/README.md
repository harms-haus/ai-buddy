# Kids Agent — Mastra Server

AI voice agent for kids, built with Mastra framework.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and configure:
   ```bash
   cp .env.example .env
   # Edit .env with your API key and base URL
   ```

3. Start the dev server:
   ```bash
   npm run dev
   ```

4. Open Mastra Studio at http://localhost:4111

## Output Processing

All agent responses pass through an output processor that strips emoji characters before they reach the caller. This uses Mastra's built-in `RegexFilterProcessor` configured with a single rule that matches:

- Standard emoji (`Emoji_Presentation`)
- Extended pictographic symbols (`Extended_Pictographic`)
- Zero-width joiner sequences (`U+200D`)
- Variation selectors (`U+FE0F`)
- Subdivision flag tags (`U+E0020`–`U+E007F`)

**Why:** Responses are read aloud via TTS, which cannot render emoji characters. The processor is always active and requires no configuration.

## API Endpoints

### Mastra Agent API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents` | List all agents |
| POST | `/api/agents/kids-agent/generate` | Generate response |
| POST | `/api/agents/kids-agent/stream` | Stream response |

### OpenAI-Compatible API

Used by Home Assistant's Extended OpenAI Conversation integration.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/chat/completions` | Chat completions (streaming and non-streaming) |
| GET | `/v1/models` | List available models (agents) |

The `model` field in requests maps to agent names: `kids-agent` and `learning-buddy` both resolve to the kids agent. Both endpoints support SSE streaming (set `"stream": true`) and standard JSON responses.

## Testing with curl

```bash
# Non-streaming (Mastra API)
curl -X POST http://localhost:4111/api/agents/kids-agent/generate \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello!"}]}'

# Streaming (Mastra API)
curl -X POST http://localhost:4111/api/agents/kids-agent/stream \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "How do you spell butterfly?"}]}'

# With memory (conversation thread)
curl -X POST http://localhost:4111/api/agents/kids-agent/generate \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "My name is Zoe"}],
    "resourceId": "user-zoe",
    "threadId": "conversation-1"
  }'

# OpenAI-compatible (non-streaming)
curl -X POST http://localhost:4111/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "kids-agent", "messages": [{"role": "user", "content": "Hello!"}]}'

# OpenAI-compatible (streaming)
curl -X POST http://localhost:4111/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "kids-agent", "stream": true, "messages": [{"role": "user", "content": "Hello!"}]}'

# List available models
curl http://localhost:4111/v1/models
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| OPENAI_API_KEY | required | API key for OpenAI-compatible endpoint |
| OPENAI_BASE_URL | - | Custom base URL for OpenAI-compatible API |
| MODEL_NAME | openai/gpt-4o | Model identifier |
| PORT | 4111 | Server port |
