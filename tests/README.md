# Tests

## Prerequisites

Install wyoming client library:
```bash
pip install wyoming
```

## Running Tests

Start all services first:
```bash
./dev.sh
```

Then in another terminal (with STT venv activated for wyoming client):
```bash
cd /home/blake/Documents/software/ai-buddy
source stt/venv/bin/activate

# Individual tests
python tests/test_stt.py        # STT Wyoming (port 10200)
python tests/test_tts.py        # TTS Wyoming (port 10201)
bash tests/test_agent.sh        # Agent HTTP (port 4111) — 5 steps: health check, generate, memory, streaming, emoji stripping

# Integration test
pip install requests            # needed for agent HTTP calls
python tests/test_integration.py
```

## Port Reference

| Service | Protocol | Port |
|---------|----------|------|
| Agent | HTTP (Mastra) | 4111 |
| TTS | Wyoming TCP | 10201 |
| STT | Wyoming TCP | 10200 |
