# @harms-haus/ai-buddy — Agent Server

AI voice buddy for kids, built with Mastra framework.

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
| POST | `/api/agents/ai-buddy/generate` | Generate response |
| POST | `/api/agents/ai-buddy/stream` | Stream response |

### OpenAI-Compatible API

Used by Home Assistant's Extended OpenAI Conversation integration.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/chat/completions` | Chat completions (streaming and non-streaming) |
| GET | `/v1/models` | List available models (agents) |

The `model` field in requests maps to agent names: `ai-buddy` and `learning-buddy` both resolve to the default agent. Both endpoints support SSE streaming (set `"stream": true`) and standard JSON responses.

## Testing with curl

```bash
# Non-streaming (Mastra API)
curl -X POST http://localhost:4111/api/agents/ai-buddy/generate \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello!"}]}'

# Streaming (Mastra API)
curl -X POST http://localhost:4111/api/agents/ai-buddy/stream \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "How do you spell butterfly?"}]}'

# With memory (conversation thread)
curl -X POST http://localhost:4111/api/agents/ai-buddy/generate \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "My name is Zoe"}],
    "resourceId": "user-zoe",
    "threadId": "conversation-1"
  }'

# OpenAI-compatible (non-streaming)
curl -X POST http://localhost:4111/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "ai-buddy", "messages": [{"role": "user", "content": "Hello!"}]}'

# OpenAI-compatible (streaming)
curl -X POST http://localhost:4111/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "ai-buddy", "stream": true, "messages": [{"role": "user", "content": "Hello!"}]}'

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
| HA_URL | - | Home Assistant WebSocket URL |
| HA_TOKEN | - | Home Assistant Long-Lived Access Token |

## Room Control

The agent can control Home Assistant entities in children's rooms (lights, fans, scenes, etc.). Each child's agent has its own set of allowed entities with kid-friendly nicknames.

### Setup

1. Set `HA_URL` and `HA_TOKEN` in your `.env` file
   - `HA_URL`: Your Home Assistant URL (e.g., `http://homeassistant.local:8123`)
   - `HA_TOKEN`: A Long-Lived Access Token from HA (Profile → Security → Create Token)

2. Copy `ha-entities.example.json` to `ha-entities.json` and configure your entities:
   ```bash
   cp ha-entities.example.json ha-entities.json
   ```

3. Edit `ha-entities.json` with your actual entity IDs and nicknames

### Entity Configuration

Each agent has a list of allowed entities with nicknames. The tool description dynamically lists available entities for the LLM. Valid entity types: `light`, `switch`, `scene`, `input_boolean`, `fan`, `media_player`.

#### Room Devices

`light`, `switch`, `scene`, `input_boolean`, and `fan` entities appear in the `control-my-room` tool. Example:

```json
{
  "zoe-agent": {
    "displayName": "Zoe",
    "entities": {
      "ceiling-light": {
        "entity_id": "light.zoe_bedroom_ceiling",
        "type": "light",
        "description": "the big light on the ceiling",
        "capabilities": ["brightness"]
      },
      "star-show": {
        "entity_id": "scene.zoe_star_show",
        "type": "scene",
        "description": "the cool laser star show!"
      }
    }
  }
}
```

#### Music Players

`media_player` entities are excluded from the `control-my-room` tool and instead appear in the `control-music` tool. Add a speaker entry like:

```json
"speaker": {
  "entity_id": "media_player.zoe_speaker",
  "type": "media_player",
  "description": "the speaker that plays music"
}
```

### Agents

| Agent ID | Model Name | Description |
|----------|-----------|-------------|
| `ai-buddy` | `ai-buddy` or `learning-buddy` | Default kids agent |
| `zoe-agent` | `zoe-agent` or `zoe` | Zoe's personal agent |
| `max-agent` | `max-agent` or `max` | Max's personal agent |

### Example

```bash
curl -X POST http://localhost:4111/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model": "zoe-agent", "stream": true, "messages": [{"role": "user", "content": "Turn on my star show!"]}'
```

## Music Control

The agent can play and control music through the **Music Assistant** integration in Home Assistant. This requires:

- The [Music Assistant](https://music-assistant.io/) integration installed in Home Assistant
- Spotify (or another music provider) linked through Music Assistant
- A `media_player` entity configured in `ha-entities.json` for the agent (see [Music Players](#music-players))
- The Music Assistant config entry ID is **auto-discovered** at startup via the HA WebSocket API — no manual configuration needed

### Tool Reference

**Tool key:** `control-music`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `action` | yes | One of: `search`, `play`, `pause`, `resume`, `next`, `previous`, `stop` |
| `query` | for search/play | Song name, artist, album, or playlist to search for |
| `media_id` | play | URI or identifier from search results (overrides `query` when playing) |
| `media_type` | no | `artist`, `album`, `track`, or `playlist` — helps narrow results |
| `artist` | no | Artist name to refine the search |
| `nickname` | no | Speaker nickname from `ha-entities.json`; defaults to the first configured speaker |

### Two-Step Playback Flow

Music playback uses a two-step flow:

1. **Search** — The LLM calls `control-music` with `action: "search"` and a `query`. Results include tracks, albums, artists, and playlists with their `media_id` values.
2. **Play** — The LLM calls `control-music` with `action: "play"` and the `media_id` from step 1.

Transport controls (`pause`, `resume`, `next`, `previous`, `stop`) are single-step calls that target the configured speaker.

### Examples

**Search for music:**

```bash
curl -X POST http://localhost:4111/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "zoe-agent",
    "messages": [{"role": "user", "content": "search for Frozen songs"}]
  }'
```

**Play a song:**

```bash
curl -X POST http://localhost:4111/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "zoe-agent",
    "messages": [{"role": "user", "content": "play Let It Go"}]
  }'
```
