# Sanity Tests

Test scripts for each service. Run these after starting the services.

## Prerequisites
- All services running (agent on :4111, TTS on :5001, STT on :5002)
- Python 3 with `requests` library (`pip install requests`)

## Run Tests

```bash
# Test agent server
./tests/test_agent.sh

# Test TTS service
python tests/test_tts.py

# Test STT service
python tests/test_stt.py

# Full integration test (all 3 services)
python tests/test_integration.py
```
