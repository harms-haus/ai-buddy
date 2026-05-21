#!/usr/bin/env python3
"""Sanity test for TTS Service"""
import sys

TTS_URL = "http://localhost:5001"

def test_health():
    import requests
    print("[1/4] Health check...")
    r = requests.get(f"{TTS_URL}/health")
    assert r.status_code == 200, f"Health check failed: {r.status_code}"
    data = r.json()
    print(f"  Status: {data['status']}, Voices: {data.get('voices', [])[:5]}...")
    return data

def test_voices():
    import requests
    print("[2/4] List voices...")
    r = requests.get(f"{TTS_URL}/voices")
    assert r.status_code == 200, f"Voices endpoint failed: {r.status_code}"
    voices = r.json()['voices']
    print(f"  Available voices: {len(voices)} total")
    return voices

def test_tts_post():
    import requests
    print("[3/4] POST /tts...")
    r = requests.post(
        f"{TTS_URL}/tts",
        json={"text": "Hello! How are you today?", "voice": "af_heart", "speed": 1.0},
    )
    assert r.status_code == 200, f"TTS POST failed: {r.status_code}"
    output_file = "tests/output_tts_post.wav"
    with open(output_file, "wb") as f:
        f.write(r.content)
    print(f"  Saved to {output_file} ({len(r.content)} bytes)")
    assert r.content[:4] == b'RIFF', "Not a valid WAV file!"
    print("  Valid WAV file ✓")
    return output_file

def test_tts_get():
    import requests
    print("[4/4] GET /tts...")
    r = requests.get(
        f"{TTS_URL}/tts",
        params={"text": "Spelling test: C A T spells cat!", "voice": "af_heart"},
    )
    assert r.status_code == 200, f"TTS GET failed: {r.status_code}"
    output_file = "tests/output_tts_get.wav"
    with open(output_file, "wb") as f:
        f.write(r.content)
    print(f"  Saved to {output_file} ({len(r.content)} bytes)")
    assert r.content[:4] == b'RIFF', "Not a valid WAV file!"
    print("  Valid WAV file ✓")
    return output_file

if __name__ == "__main__":
    print("=== Testing TTS Service ===")
    test_health()
    test_voices()
    test_tts_post()
    test_tts_get()
    print("\n=== All TTS tests passed! ===")
