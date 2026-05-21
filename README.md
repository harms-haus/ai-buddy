# Kids AI Voice Agent

A voice AI agent for two young children (Maxwell, 4.5yo autistic and Zoe, 6yo) that will eventually integrate with Home Assistant via a Satellite1 hardware device.

## Status: Vertical Slice (MVP)

This is the initial build — 3 independent HTTP services testable separately:

| Service | Tech | Port | Description |
|---------|------|------|-------------|
| **Agent** | Mastra (Node.js) | 4111 | AI agent with conversation memory |
| **TTS** | Kokoro-ONNX (Python) | 5001 | Text-to-speech with GPU acceleration (54 voices) |
| **STT** | faster-whisper (Python) | 5002 | Speech-to-text with GPU acceleration |

## Architecture

```
[Text Input]
    -> Mastra Agent (port 4111) -> [Text Response]
    -> Kokoro TTS (port 5001) -> [Audio WAV]
    -> faster-whisper STT (port 5002) -> [Transcription]
```

## Prerequisites

- **Node.js** 22+ (for Mastra agent)
- **Python** 3.10+ (for STT/TTS services)
- **NVIDIA GPU** with CUDA 12 + cuDNN 9 (optional — CPU fallback available)
- **OpenAI-compatible LLM API** key and endpoint
- `pip install requests` (for running test scripts)

## Quick Start

### 1. Agent Server

```bash
cd agent
cp .env.example .env
# Edit .env: Set OPENAI_API_KEY and OPENAI_BASE_URL to your provider
npm install
npm run dev    # Starts Mastra Studio at http://localhost:4111
```

### 2. TTS Service (Kokoro)

```bash
cd tts
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python download_model.py  # Downloads ~324MB ONNX model + voices
python server.py           # Starts on port 5001
```

Test: `curl "http://localhost:5001/tts?text=Hello+world&voice=af_heart" --output test.wav`

### 3. STT Service (faster-whisper)

```bash
cd stt
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python download_model.py  # Downloads ~1.5GB Whisper model
python server.py           # Starts on port 5002
```

Test: `curl -X POST http://localhost:5002/stt -F "file=@audio.wav"`

### 4. Run Sanity Tests

```bash
# Start all 3 services in separate terminals, then:
./tests/test_agent.sh       # Test agent generate + stream
python tests/test_tts.py    # Test TTS synthesis + WAV output
python tests/test_stt.py    # Test STT transcription
python tests/test_integration.py  # Full pipeline: text->agent->tts->stt->text
```

## Environment Variables

### Agent (agent/.env)
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| OPENAI_API_KEY | Yes | — | API key for LLM provider |
| OPENAI_BASE_URL | Yes | — | Base URL for OpenAI-compatible API |
| PORT | | 4111 | Server port |

### TTS (tts/.env)
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| TTS_PORT | | 5001 | Server port |
| KOKORO_VOICE | | af_heart | Default voice (54 available) |
| KOKORO_SPEED | | 1.0 | Speech speed (0.5-2.0) |

### STT (stt/.env)
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| STT_PORT | | 5002 | Server port |
| WHISPER_MODEL | | medium.en | Whisper model name |

## Project Structure

```
kids-agent/
  agent/              # Mastra agent server (Node.js)
    src/mastra/
      index.ts            # Mastra entry point + storage
      agents/
        kids-agent.ts   # Agent with memory + system prompt
    package.json
    tsconfig.json
    .env.example
  stt/                # Speech-to-text (Python)
    server.py              # FastAPI server
    download_model.py      # Pre-download Whisper model
    requirements.txt
    .env.example
  tts/                # Text-to-speech (Python)
    server.py              # FastAPI server (kokoro-onnx)
    download_model.py      # Pre-download Kokoro model
    requirements.txt
    .env.example
  tests/              # Sanity test scripts
    test_agent.sh          # Agent generate + stream
    test_tts.py            # TTS synthesis test
    test_stt.py            # STT transcription test
    test_integration.py    # Full pipeline test
    README.md
  research/           # Architecture research docs
  README.md           # This file
```

## Key Voices (for kids)

| Voice | Gender | Notes |
|-------|--------|-------|
| af_heart | Female | Default - warm, friendly |
| af_sky | Female | Bright, clear |
| af_sarah | Female | Warm, measured |
| af_nicole | Female | Natural, conversational |
| af_bella | Female | Softer tone |
| am_adam | Male | Male option |
| am_michael | Male | Male option |

## Hardware

- Voice I/O: FutureProofHomes Satellite1 (Wyoming satellite) - not yet connected
- GPU: NVIDIA RTX 3060 (12GB VRAM)
- VRAM Budget: ~2GB total (STT: ~1.5GB, TTS: ~0.5GB)
- Headroom: ~10GB for future local LLM or other models

## Next Steps

After this vertical slice works:
1. Wyoming protocol bridge for Kokoro TTS (connect to Home Assistant)
2. Home Assistant integration via Extended OpenAI Conversation (HACS)
3. Safety pipeline (keyword filter + toxicity classifier + output screening)
4. Satellite1 hardware setup and ESPHome configuration
5. End-to-end voice pipeline testing with real hardware
6. LLM provider benchmarking (Groq, Claude, GPT-4o) for lowest latency
7. Voice selection testing with the kids
