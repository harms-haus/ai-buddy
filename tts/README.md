# TTS Service — Kokoro (Wyoming Protocol)

Text-to-speech using [Kokoro-82M](https://github.com/thewh1teagle/kokoro-onnx) (ONNX), exposed via [Wyoming protocol](https://github.com/OHF-Voice/wyoming) for Home Assistant integration.

## Setup

```bash
cd tts
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

To download model files:
```bash
python download_model.py
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `TTS_PORT` | `10201` | Wyoming TCP port |
| `TTS_HOST` | `0.0.0.0` | Listen address |
| `KOKORO_VOICE` | `af_heart` | Default voice |
| `KOKORO_SPEED` | `1.0` | Default speed (0.5–2.0) |
| `KOKORO_MODEL_PATH` | `kokoro-v1.0.onnx` | Path to ONNX model |
| `KOKORO_VOICES_PATH` | `voices-v1.0.bin` | Path to voices file |

## Running

```bash
python server.py
```

The server registers with Home Assistant via Zeroconf/mDNS (service: `kids-agent-tts`). If HA doesn't auto-discover, manually add a Wyoming integration with host:port.

## Wyoming Protocol

Implements TTS (Text-to-Speech) via Wyoming TCP protocol:

- **Describe** → returns Info with TTS programs and available voices
- **Synthesize** → receives text, returns streaming audio (24kHz, 16-bit, mono)
- Audio is streamed in chunks for low-latency playback
- Uses `create_stream()` for sentence-level synthesis

## Voices

Kokoro includes 54 voices. Notable English voices:
- `af_heart`, `af_sky`, `af_sarah`, `af_nicole`, `af_bella` (female)
- `am_michael`, `am_adam` (male)

Full list available via the Describe response.

## Testing

```bash
python tests/test_tts.py
```
