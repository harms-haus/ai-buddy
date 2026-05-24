# STT Service — faster-whisper (Wyoming Protocol)

Speech-to-text using [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (CTranslate2-based Whisper), exposed via [Wyoming protocol](https://github.com/OHF-Voice/wyoming) for Home Assistant integration.

## Setup

```bash
cd stt
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

To pre-download the model:
```bash
python download_model.py
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `STT_PORT` | `10200` | Wyoming TCP port |
| `STT_HOST` | `0.0.0.0` | Listen address |
| `WHISPER_MODEL` | `medium.en` | Whisper model name |

GPU device and compute type are auto-detected (CUDA if available, otherwise CPU).

## Running

```bash
python server.py
```

The server registers with Home Assistant via Zeroconf/mDNS (service: `kids-agent-stt`). If HA doesn't auto-discover, manually add a Wyoming integration with host:port.

## Wyoming Protocol

Implements ASR (Automatic Speech Recognition) via Wyoming TCP protocol:

- **Describe** → returns Info with ASR programs and models
- **Transcribe** → sets language/context
- **AudioStart / AudioChunk / AudioStop** → receives PCM audio (16kHz, 16-bit, mono)
- **Transcript** → returns transcribed text

## Testing

```bash
python tests/test_stt.py
```
