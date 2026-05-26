#!/usr/bin/env python3
"""TTS Wyoming server test."""

# Usage: TTS_BACKEND=chatterbox python tests/test_tts.py
# (Server must be running with matching backend: ./dev.sh --tts=chatterbox)

import asyncio
import os
import sys

from wyoming.client import AsyncClient
from wyoming.tts import Synthesize
from wyoming.audio import AudioStart, AudioChunk, AudioStop
from wyoming.info import Describe, Info

TTS_BACKEND = os.getenv("TTS_BACKEND", "kokoro")
TTS_URI = "tcp://localhost:10201"


async def test_describe():
    """Test Describe → Info response."""
    print("Testing Describe...")
    client = AsyncClient.from_uri(TTS_URI)
    await client.connect()
    await client.write_event(Describe().event())
    event = await client.read_event()
    assert event is not None, "No response from server"
    assert Info.is_type(event.type), f"Expected Info, got {event.type}"
    info = Info.from_event(event)
    assert len(info.tts) > 0, "No TTS programs in Info"
    voices = [v.name for p in info.tts for v in p.voices]
    print(f"  ✓ TTS programs: {[p.name for p in info.tts]}")
    print(f"  ✓ Voices ({len(voices)}): {voices[:5]}...")

    expected_names = {
        "kokoro": "kokoro",
        "chatterbox": "chatterbox",
        "dia": "dia",
        "chattts": "chattts",
    }
    expected = expected_names.get(TTS_BACKEND, TTS_BACKEND)
    assert info.tts[0].name == expected, f"Expected backend '{expected}', got '{info.tts[0].name}'"
    print(f"  ✓ Backend: {info.tts[0].name}")

    await client.disconnect()
    return info


async def test_synthesize():
    """Test Synthesize → AudioStart/Chunk*/AudioStop."""
    print("Testing Synthesize...")
    client = AsyncClient.from_uri(TTS_URI)
    await client.connect()
    await client.write_event(
        Synthesize(text="Hello world, this is a test.", voice=None).event()
    )

    # Collect audio chunks
    audio_chunks = []
    rate = width = channels = None

    while True:
        event = await client.read_event()
        assert event is not None, "Server disconnected unexpectedly"

        if AudioStart.is_type(event.type):
            start = AudioStart.from_event(event)
            rate = start.rate
            width = start.width
            channels = start.channels
            print(f"  ✓ AudioStart: {rate}Hz, {width*8}bit, {channels}ch")
        elif AudioChunk.is_type(event.type):
            chunk = AudioChunk.from_event(event)
            audio_chunks.append(chunk.audio)
        elif AudioStop.is_type(event.type):
            print(f"  ✓ AudioStop")
            break

    total_audio = b"".join(audio_chunks)
    print(f"  ✓ Total audio: {len(total_audio)} bytes")
    assert len(total_audio) > 0, "No audio received"
    assert rate == 24000, f"Expected 24000Hz, got {rate}"
    assert width == 2, f"Expected 16-bit, got {width*8}-bit"

    # Save to WAV for manual verification
    import wave
    output_path = f"tests/output_tts_{TTS_BACKEND}.wav"
    with wave.open(output_path, "wb") as wf:
        wf.setframerate(rate)
        wf.setsampwidth(width)
        wf.setnchannels(channels)
        wf.writeframes(total_audio)
    print(f"  ✓ Saved to {output_path}")

    await client.disconnect()


async def test_voices_available(info):
    """Test that voices list is non-empty."""
    voices = info.tts[0].voices
    assert len(voices) > 0, "No voices available"
    print(f"  ✓ Voices: {len(voices)} available ({voices[0].name}, ...)")

    # Backend-specific checks
    if TTS_BACKEND == "kokoro":
        voice_names = [v.name for v in voices]
        assert "af_heart" in voice_names, "Expected 'af_heart' in Kokoro voices"
    elif TTS_BACKEND == "chattts":
        voice_names = [v.name for v in voices]
        assert "random" in voice_names, "Expected 'random' in ChatTTS voices"


async def main():
    print(f"=== TTS Wyoming Server Tests (backend: {TTS_BACKEND}) ===\n")
    try:
        info = await test_describe()
        print()
        await test_voices_available(info)
        print()
        await test_synthesize()
        print("\n✅ All TTS tests passed!")
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
