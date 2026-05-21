#!/usr/bin/env python3
"""Sanity test for STT Service"""
import wave
import struct
import tempfile
import os

STT_URL = "http://localhost:5002"

def generate_test_audio():
    """Generate a simple test WAV file (sine wave — tests endpoint but won't transcribe to words)."""
    sample_rate = 16000
    duration = 2.0
    frequency = 440
    
    n_samples = int(sample_rate * duration)
    samples = []
    for i in range(n_samples):
        t = i / sample_rate
        value = int(32767 * 0.5 * (1 if (t * frequency) % 1 < 0.5 else -1))
        samples.append(struct.pack('<h', value))
    
    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    with wave.open(tmp.name, 'w') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(b''.join(samples))
    return tmp.name

def test_health():
    import requests
    print("[1/2] Health check...")
    r = requests.get(f"{STT_URL}/health")
    assert r.status_code == 200, f"Health check failed: {r.status_code}"
    data = r.json()
    print(f"  Status: {data['status']}, Model: {data['model']}, Device: {data['device']}")

def test_stt():
    import requests
    print("[2/2] POST /stt with test audio...")
    audio_path = generate_test_audio()
    try:
        with open(audio_path, 'rb') as f:
            r = requests.post(
                f"{STT_URL}/stt",
                files={"file": ("test.wav", f, "audio/wav")},
            )
        assert r.status_code == 200, f"STT failed: {r.status_code} - {r.text}"
        data = r.json()
        print(f"  Text: '{data['text']}'")
        print(f"  Language: {data['language']} ({data['language_probability']})")
        print(f"  Duration: {data['duration']}s")
        print("  Note: Test audio is a sine wave — transcription may be empty, that's OK!")
    finally:
        os.unlink(audio_path)

if __name__ == "__main__":
    print("=== Testing STT Service ===")
    test_health()
    test_stt()
    print("\n=== All STT tests passed! ===")
