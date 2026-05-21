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

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents` | List all agents |
| POST | `/api/agents/kids-agent/generate` | Generate response |
| POST | `/api/agents/kids-agent/stream` | Stream response |

## Testing with curl

```bash
# Non-streaming
curl -X POST http://localhost:4111/api/agents/kids-agent/generate \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello!"}]}'

# Streaming
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
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| OPENAI_API_KEY | required | API key for OpenAI-compatible endpoint |
| OPENAI_BASE_URL | - | Custom base URL for OpenAI-compatible API |
| MODEL_NAME | openai/gpt-4o | Model identifier |
| PORT | 4111 | Server port |
