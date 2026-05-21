# TTS Service — Kokoro

Text-to-speech service using Kokoro with GPU acceleration.

## Setup

1. Create a virtual environment:
   ```bash
   cd tts
   python -m venv venv
   source venv/bin/activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. (Optional) Pre-download model:
   ```bash
   python download_model.py
   ```

4. Configure:
   ```bash
   cp .env.example .env
   ```

5. Start the server:
   ```bash
   python server.py
   ```

## API

### POST /tts
Convert text to speech.

```bash
curl -X POST http://localhost:5001/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello! How are you today?", "voice": "af_heart"}' \
  --output speech.wav
```

### GET /tts
```bash
curl "http://localhost:5001/tts?text=Hello+world&voice=af_heart" --output speech.wav
```

### GET /voices
List available voices.

### GET /health
Health check.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| TTS_PORT | 5001 | Server port |
| TTS_HOST | 0.0.0.0 | Server host |
| KOKORO_VOICE | af_heart | Default voice |
| KOKORO_SPEED | 1.0 | Speech speed |
