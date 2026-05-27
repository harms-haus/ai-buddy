# @harms-haus/ai-buddy

A voice assistant for two young children — **Max** (4.5yo) and **Zoe** (6yo) — integrated with Home Assistant via Wyoming protocol and a Satellite1 hardware device. The agent can answer questions, control smart home devices, check the weather, and play music.

Three services work together to form a complete voice pipeline:

| Service | Tech | Port | Protocol |
|---------|------|------|----------|
| **Agent** | Mastra (Node.js) | 4111 | HTTP — OpenAI-compatible API |
| **TTS** | Multi-backend (Python) | 10201 | Wyoming TCP |
| **STT** | faster-whisper (Python) | 10200 | Wyoming TCP |

## Architecture

```
Satellite1 (wake word)
  → HA Voice Pipeline
    → STT (Wyoming :10200) — faster-whisper on GPU
    → Agent (:4111) — Mastra via Extended OpenAI Conversation
    → TTS (Wyoming :10201) — multi-backend (Kokoro, Chatterbox, Dia, ChatTTS)
  → Satellite1 speaker
```

The agent exposes an OpenAI Chat Completions–compatible API (`/v1/chat/completions`, `/v1/models`) so Home Assistant's **Extended OpenAI Conversation** integration can call it directly. All agent responses pass through a `RegexFilterProcessor` that strips emoji (including ZWJ sequences and flag tags) before the text reaches TTS — since every response is read aloud, emoji would only add noise. STT and TTS register as Wyoming devices and are discovered by Home Assistant via Zeroconf/mDNS.

## Quick Start

### Prerequisites

- **Node.js** 22+
- **Python** 3.10+
- **NVIDIA GPU** with CUDA 12 + cuDNN 9 (optional — CPU fallback available)
- **OpenAI-compatible LLM** API key and endpoint
- **Music Assistant** integration in Home Assistant (optional — needed for music control; without it, the music tool returns a friendly message)
- **SearXNG** (optional — self-hosted search engine for web search capability)

### Install

```bash
# Agent
cd agent
cp .env.example .env
# Edit .env — set OPENAI_API_KEY and OPENAI_BASE_URL
npm install

# TTS
cd ../tts
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python download_model.py        # ~324MB ONNX model + voices
# Choose your TTS backend:
# kokoro (default), chatterbox, dia, or chattts
# See tts/README.md for backend-specific setup

# STT
cd ../stt
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python download_model.py        # ~1.5GB Whisper model
```

### Run

```bash
./dev.sh                        # starts all 3 services (Kokoro TTS default)
./dev.sh --tts=chatterbox       # start with Chatterbox TTS
./dev.sh --tts=dia              # start with Dia TTS
./dev.sh --stop                 # stop all services
```

`dev.sh` builds and starts the agent, TTS, and STT, then waits for each port to become ready. Press **Ctrl+C** to stop everything.

## Configuration

### Agent (`agent/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | — | API key for your LLM provider |
| `OPENAI_BASE_URL` | — | Base URL for OpenAI-compatible endpoint |
| `MODEL_NAME` | `openai/gpt-4o` | Model identifier |
| `PORT` | `4111` | HTTP server port |
| `WEATHER_LOCATION` | — | Default city name for weather tool (e.g., `Leander` or `Austin`) |
| `SEARCH_API_URL` | — | URL of your SearXNG instance (e.g., `http://localhost:8080`). Required for web search |
| `WEB_FETCH_CACHE_TTL` | `600000` | Cache TTL for fetched web pages in milliseconds |

### TTS (`tts/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `TTS_PORT` | `10201` | Wyoming TCP port |
| `TTS_HOST` | `127.0.0.1` | Listen address |
| `KOKORO_VOICE` | `af_heart` | Default voice (54 available) |
| `KOKORO_SPEED` | `1.0` | Speech speed (0.5–2.0) |
| `KOKORO_MODEL_PATH` | `kokoro-v1.0.onnx` | Path to ONNX model |
| `KOKORO_VOICES_PATH` | `voices-v1.0.bin` | Path to voices file |

### STT (`stt/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `STT_PORT` | `10200` | Wyoming TCP port |
| `STT_HOST` | `0.0.0.0` | Listen address |
| `WHISPER_MODEL` | `medium.en` | Whisper model name |

## Home Assistant Integration

### 1. Wyoming STT

Start the STT service (`python stt/server.py`). Home Assistant should auto-discover it via mDNS (service: `ai-buddy-stt`). If not, add a **Wyoming** integration manually with the STT host and port.

### 2. Wyoming TTS

Start the TTS service (`python tts/server.py`). Same discovery flow — service name is `ai-buddy-tts-{backend}` (e.g. `ai-buddy-tts-kokoro`). Add manually if needed.

### 3. Extended OpenAI Conversation (Agent)

Install **Extended OpenAI Conversation** via HACS, then configure:

| Setting | Value |
|---------|-------|
| Endpoint | `http://<agent-host>:4111/v1/chat/completions` |
| API Key | Your `OPENAI_API_KEY` (or any non-empty string if skip-auth is on) |
| Model | `ai-buddy` or `learning-buddy` |

The agent exposes `/v1/models` listing both names. Both resolve to the same underlying agent.

### 4. Voice Assistant Pipeline

In HA, go to **Settings → Voice assistants** and create a pipeline:

1. **Wake word** — use Satellite1's built-in ("Hey Jarvis" or "Okay Nabu")
2. **STT** — select the Wyoming STT device
3. **Conversation agent** — select the Extended OpenAI Conversation entry
4. **TTS** — select the Wyoming TTS device

## Testing

See [`tests/README.md`](tests/README.md) for details on individual and integration tests.

```bash
./dev.sh   # start all services first
# Then in another terminal:
python tests/test_stt.py           # Wyoming STT (port 10200)
python tests/test_tts.py           # Wyoming TTS (port 10201)
bash tests/test_agent.sh           # Agent HTTP (port 4111)
python tests/test_integration.py   # Full pipeline
```

## Project Structure

```
ai-buddy/
├── agent/                  # Mastra agent (Node.js)
│   ├── src/mastra/
│   │   ├── index.ts            # Mastra entry + OpenAI-compatible routes
│   │   ├── agents/
│   │   │   └── kids-agent.ts   # Agent definition + system prompt
│   │   └── tools/
│   │       ├── weather.ts          # Weather tool (Open-Meteo API)
│   │       ├── ha-control.ts       # Smart home control tool (lights, etc.)
│   │       ├── ha-music.ts         # Music control tool (Music Assistant)
│   │       ├── ha-music-config.ts  # Music Assistant config discovery & helpers
│   │       ├── web-search.ts       # Web search tool (SearXNG)
│   │       └── web-fetch.ts        # Web page fetcher with content extraction
│   └── .env.example
├── stt/                    # Speech-to-text (Python, Wyoming)
│   ├── server.py               # Wyoming STT server
│   └── download_model.py
├── tts/                    # Text-to-speech (Python, Wyoming)
│   ├── server.py               # Wyoming TTS server
│   └── download_model.py
├── tests/                  # Test scripts (see tests/README.md)
├── research/               # Architecture research + decisions
│   └── HANDOFF.md              # Full project context
└── dev.sh                  # Dev launcher (all services)
```

## Features

### Music Control

The agent can control music playback through Home Assistant's **Music Assistant** integration:

- **Search** for songs, artists, albums, and playlists by name
- **Play** music on configured speakers (supports Spotify and other Music Assistant sources)
- **Pause, resume, skip, go back, stop** playback
- Each child's agent can have its own default speaker

Music control requires the [Music Assistant](https://github.com/music-assistant/home-assistant) integration installed in Home Assistant. If it's not set up, the agent will politely let the kids know and suggest asking a grown-up for help.

### Web Search & Fetch

The agent can search the web and read web pages using a self-hosted **SearXNG** instance:

- **Search** the web for facts, current events, or topics the assistant doesn't know about
- **Fetch and read** web page content, extracting readable article text with pagination for long pages
- Both tools degrade gracefully with kid-friendly messages when SearXNG is unconfigured or requests fail
- Uses `@mozilla/readability`, `linkedom`, and `node-html-markdown` for HTML-to-text extraction

## Hardware

- **Voice I/O**: Satellite1 (Wyoming satellite, ESPHome)
- **GPU**: NVIDIA RTX 3060 (12GB VRAM) — STT ~1.5GB + TTS ~0.5GB ≈ 2GB total
- **Latency target**: <800ms mouth-to-ear

## More Context

- **Per-service docs**: [`agent/README.md`](agent/README.md), [`stt/README.md`](stt/README.md), [`tts/README.md`](tts/README.md)
