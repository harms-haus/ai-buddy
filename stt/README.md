# STT Service — faster-whisper

Speech-to-text service using faster-whisper with GPU acceleration.

## Setup

1. Create a virtual environment:
   ```bash
   cd stt
   python -m venv venv
   source venv/bin/activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. (Optional) Pre-download the model:
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

### POST /stt
Upload an audio file for transcription.

```bash
curl -X POST http://localhost:5002/stt \
  -F "file=@recording.wav"
```

Response:
```json
{
  "text": "Hello how are you",
  "language": "en",
  "language_probability": 0.99,
  "duration": 2.5,
  "segments": [{"start": 0.0, "end": 2.5, "text": "Hello how are you"}]
}
```

### GET /health
Health check.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| STT_PORT | 5002 | Server port |
| STT_HOST | 0.0.0.0 | Server host |
| WHISPER_MODEL | medium.en | Whisper model name |
