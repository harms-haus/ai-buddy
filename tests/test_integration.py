#!/usr/bin/env python3
"""
Integration test: Full pipeline test
Text → Agent → TTS → Audio → STT → Text
"""
import io
import sys

AGENT_URL = "http://localhost:4111"
TTS_URL = "http://localhost:5001"
STT_URL = "http://localhost:5002"

def test_full_pipeline():
    import requests
    
    print("=== Integration Test: Full Pipeline ===")
    test_message = "What color is the sky?"
    
    # Step 1: Get agent response
    print(f"[1/3] Getting agent response for: '{test_message}'")
    r = requests.post(
        f"{AGENT_URL}/api/agents/kids-agent/generate",
        json={"messages": [{"role": "user", "content": test_message}]},
    )
    assert r.status_code == 200, f"Agent failed: {r.status_code} - {r.text}"
    
    agent_response = r.json()
    # Try to extract text from various response formats
    response_text = ''
    if isinstance(agent_response, dict):
        response_text = agent_response.get('text', '')
        if not response_text:
            msg = agent_response.get('message', {})
            if isinstance(msg, dict):
                response_text = msg.get('content', '')
            elif isinstance(msg, str):
                response_text = msg
        if not response_text:
            # Mastra may return different format
            response_text = str(agent_response.get('response', agent_response.get('result', '')))
    if not response_text:
        response_text = str(agent_response)
    
    print(f"  Agent said: {response_text[:200]}")
    
    # Step 2: Convert to speech
    print("[2/3] Converting to speech...")
    r = requests.post(
        f"{TTS_URL}/tts",
        json={"text": response_text[:500], "voice": "af_heart"},
    )
    assert r.status_code == 200, f"TTS failed: {r.status_code}"
    assert r.content[:4] == b'RIFF', "Not a valid WAV file!"
    audio_data = r.content
    print(f"  Got audio: {len(audio_data)} bytes")
    
    # Step 3: Transcribe back
    print("[3/3] Transcribing audio back...")
    r = requests.post(
        f"{STT_URL}/stt",
        files={"file": ("speech.wav", io.BytesIO(audio_data), "audio/wav")},
    )
    assert r.status_code == 200, f"STT failed: {r.status_code} - {r.text}"
    transcription = r.json()
    print(f"  Transcribed: '{transcription['text']}'")
    
    print("\n=== Integration test complete! ===")
    print(f"Original:  {test_message}")
    print(f"Agent:     {response_text[:200]}")
    print(f"Roundtrip: {transcription['text']}")

if __name__ == "__main__":
    test_full_pipeline()
