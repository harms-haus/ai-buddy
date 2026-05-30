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
   # Edit .env — set OPENAI_API_KEY, OPENAI_BASE_URL, and optional
   # variables like SEARCH_API_URL (for web search) and HA_URL/HA_TOKEN
   # (for room control and music)
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
| WEATHER_LOCATION | - | Default city for weather lookups (e.g. `Austin` or `Katy,Tx,US`) |
| SEARCH_API_URL | - | URL of your SearXNG instance (e.g. `http://localhost:8080`). Required for web search. |
| WEB_FETCH_CACHE_TTL | `600000` | Cache TTL for fetched web pages in milliseconds |

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

`media_player` entities are excluded from the `control-my-room` tool and instead appear in the `control-music` tool. When `unit_entity_id` is set, they also power the `control-volume` tool for direct speaker volume control. Add a speaker entry like:

```json
"speaker": {
  "entity_id": "media_player.zoe_speaker",
  "type": "media_player",
  "description": "the speaker that plays music",
  "unit_entity_id": "media_player.zoe_speaker_satellite"
}
```

- `unit_entity_id` — The HA entity ID of the physical satellite/hardware unit whose volume can be controlled independently of the Music Assistant player entity. Must match `domain.entity_id` format (e.g., `media_player.satellite1`).
- **Optional** — if omitted, the volume tool gracefully reports "No volume-controllable speakers configured yet" rather than failing.

### Agents

| Agent ID | Model Name | Description |
|----------|-----------|-------------|
| `ai-buddy` | `ai-buddy` or `learning-buddy` | Default kids agent |
| `zoe-agent` | `zoe-agent` or `zoe` | Zoe's personal agent |
| `max-agent` | `max-agent` or `max` | Max's personal agent |

> **Note:** `zoe-agent` and `max-agent` support dynamic usernames via the `change-username` tool. `ai-buddy` uses a fixed default name ("kiddo") and does not expose the tool. See [Username / Nickname](#username--nickname) for details.

### Example

```bash
curl -X POST http://localhost:4111/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model": "zoe-agent", "stream": true, "messages": [{"role": "user", "content": "Turn on my star show!"]}'
```

## Username / Nickname

Each agent greets the user by name. The name is injected into the system prompt as `The user's name is '...'` on every request, so the LLM always knows what to call them.

### Default Names

| Agent ID | Default Name |
|----------|-------------|
| `zoe-agent` | `zoe` |
| `max-agent` | `max` |
| `ai-buddy` | `kiddo` |

### How It Works

- `zoe-agent` and `max-agent` include the `change-username` tool, allowing the user to change what the agent calls them at any time (e.g., "call me Zo-Zo").
- `ai-buddy` does **not** have the tool — it always uses the default name `kiddo`.
- Names are persisted in `data/usernames.json`, keyed by agent ID. This is separate from Mastra Memory and survives across conversation threads.
- If `data/usernames.json` doesn't exist or is unreadable, the agent falls back to its default name.

### Tool Reference — change-username

**Tool key:** `change-username`

Changes the name the agent uses for the user. Only available on `zoe-agent` and `max-agent`.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `new_name` | yes | The new name (1–32 characters, letters, numbers, spaces, hyphens, and apostrophes only) |

### Examples

**Change Zoe's nickname:**

```bash
curl -X POST http://localhost:4111/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "zoe-agent",
    "messages": [{"role": "user", "content": "call me Zo-Zo from now on"}]
  }'
```

**Change Max's nickname:**

```bash
curl -X POST http://localhost:4111/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "max-agent",
    "messages": [{"role": "user", "content": "call me Maximus"}]
  }'
```

The name is stored immediately and will be used in all future conversations with that agent.

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

### Tool Reference — control-volume

**Tool key:** `control-volume`

Controls the volume of the satellite speaker directly. Supports absolute volume setting (0–10 scale), relative volume adjustments (increase/decrease by steps), and mute/unmute. Uses the `unit_entity_id` entity from `ha-entities.json` for volume operations. Only available when a `media_player` entity with a `unit_entity_id` is configured for the agent.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `increase` | one of four | Steps to turn up volume (0–10, each step adds ~10%) |
| `decrease` | one of four | Steps to turn down volume (0–10, each step removes ~10%) |
| `set_volume` | one of four | Set volume to a specific level (0–10, where 0 is silent and 10 is max). Maps directly: 5 = 50%, 8 = 80%. |
| `mute` | one of four | `true` to mute, `false` to unmute |
| `nickname` | no | Speaker nickname from `ha-entities.json`; defaults to first configured speaker |

> **Note:** Exactly one of `increase`, `decrease`, `mute`, or `set_volume` must be provided per call.

### Examples

**Turn up the volume:**

```bash
curl -X POST http://localhost:4111/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "zoe-agent",
    "messages": [{"role": "user", "content": "turn up the music"}]
  }'
```

**Turn down the volume:**

```bash
curl -X POST http://localhost:4111/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "zoe-agent",
    "messages": [{"role": "user", "content": "make it quieter"}]
  }'
```

**Mute the speaker:**

```bash
curl -X POST http://localhost:4111/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "zoe-agent",
    "messages": [{"role": "user", "content": "mute my speaker"}]
  }'
```

**Set volume to a specific level:**

```bash
curl -X POST http://localhost:4111/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "zoe-agent",
    "messages": [{"role": "user", "content": "set the volume to 8"}]
  }'
```

## Web Search & Web Fetch

The agent can search the web and read web pages using two tools: **web-search** queries a SearXNG instance for results, and **web-fetch** retrieves and extracts the text content of a URL. The LLM uses these together — searching first, then fetching promising links to answer a question in detail.

These tools depend on three npm packages: `@mozilla/readability`, `linkedom`, and `node-html-markdown`. They are installed automatically with `npm install`.

### SearXNG Setup

Web search requires a [SearXNG](https://github.com/searxng/searxng) instance. The quickest way to run one locally:

```bash
docker run -d -p 8080:8080 searxng/searxng
```

Then set `SEARCH_API_URL=http://localhost:8080` in your `.env`. If `SEARCH_API_URL` is not set, the web-search tool returns a kid-friendly fallback message instead of failing.

### Tool Reference — web-search

**Tool key:** `web-search`

Queries the SearXNG JSON API and returns a formatted summary of results (title, snippet, link). Snippets are truncated at 150 characters.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `query` | yes | What to search for |
| `max_results` | no | Maximum number of results to return (1–10, default 5) |

### Tool Reference — web-fetch

**Tool key:** `web-fetch`

Fetches a URL, extracts the main content using Mozilla Readability (with a full-page markdown fallback), and returns a paginated text window.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | yes | The web address to fetch |
| `start` | no | Character position to start reading from (≥ 0, default 0) |
| `count` | no | How many characters to return (500–16000, default 8000) |

Long pages are returned in chunks. When there is more content, the response includes a pagination footer with the next `start` value.

#### How it works

1. The URL is validated — only `http:` and `https:` schemes are allowed.
2. **Security**: requests to `localhost`, `127.0.0.1`, private IP ranges (`10.*`, `172.16–31.*`, `192.168.*`, `100.64–127.*`), and cloud metadata endpoints (`169.254.169.254`) are blocked.
3. HTML is fetched with a 15-second timeout and a 2 MB size limit.
4. Content is extracted via Mozilla Readability (best for articles); if that fails, the full page is converted to markdown via `node-html-markdown`, stripping `nav`, `footer`, `aside`, and `header` elements.
5. Extracted content is cached in memory (up to 100 entries, 500 KB each) with a configurable TTL (`WEB_FETCH_CACHE_TTL`, default 10 minutes). LRU-style eviction drops the oldest entry when the cache is full.

### Examples

**Web search:**

```bash
curl -X POST http://localhost:4111/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "ai-buddy",
    "messages": [{"role": "user", "content": "How far away is the moon?"}]
  }'
```

**Web fetch (the LLM calls this automatically after search):**

```bash
curl -X POST http://localhost:4111/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "ai-buddy",
    "messages": [{"role": "user", "content": "Read this article and tell me about it: https://en.wikipedia.org/wiki/Moon"}]
  }'
```
