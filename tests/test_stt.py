#!/usr/bin/env python3
"""STT Wyoming server test."""

import asyncio
import struct
import math
import sys

from wyoming.client import AsyncClient
from wyoming.asr import Transcribe, Transcript
from wyoming.audio import AudioStart, AudioChunk, AudioStop
from wyoming.info import Describe, Info

STT_URI = "tcp://localhost:10200"


def generate_sine_wav_pcm(duration_sec: float = 2.0, freq: float = 440.0, sample_rate: int = 16000) -> bytes:
    """Generate a sine wave as raw PCM bytes (16-bit, mono)."""
    num_samples = int(duration_sec * sample_rate)
    pcm = bytearray()
    for i in range(num_samples):
        sample = math.sin(2 * math.pi * freq * i / sample_rate)
        pcm.extend(struct.pack("<h", int(sample * 16000)))  # 16-bit signed
    return bytes(pcm)


async def test_describe():
    """Test Describe → Info response."""
    print("Testing Describe...")
    client = AsyncClient.from_uri(STT_URI)
    await client.connect()
    await client.write_event(Describe().event())
    event = await client.read_event()
    assert event is not None, "No response from server"
    assert Info.is_type(event.type), f"Expected Info, got {event.type}"
    info = Info.from_event(event)
    assert len(info.asr) > 0, "No ASR programs in Info"
    print(f"  ✓ ASR programs: {[p.name for p in info.asr]}")
    print(f"  ✓ Models: {[[m.name for m in p.models] for p in info.asr]}")
    await client.disconnect()


async def test_transcribe():
    """Test Transcribe → AudioStart/Chunk/Stop → Transcript."""
    print("Testing Transcribe...")
    pcm = generate_sine_wav_pcm()

    client = AsyncClient.from_uri(STT_URI)
    await client.connect()
    await client.write_event(Transcribe(language="en").event())
    await client.write_event(AudioStart(rate=16000, width=2, channels=1).event())

    # Send audio in chunks
    chunk_size = 4096
    for i in range(0, len(pcm), chunk_size):
        await client.write_event(
            AudioChunk(
                audio=pcm[i:i+chunk_size],
                rate=16000,
                width=2,
                channels=1,
            ).event()
        )

    await client.write_event(AudioStop().event())

    # Read response
    event = await client.read_event()
    assert event is not None, "No transcript response"
    assert Transcript.is_type(event.type), f"Expected Transcript, got {event.type}"
    transcript = Transcript.from_event(event)
    print(f"  ✓ Transcript: '{transcript.text}'")
    print(f"  ✓ Language: {transcript.language}")
    await client.disconnect()


async def main():
    print("=== STT Wyoming Server Tests ===\n")
    try:
        await test_describe()
        print()
        await test_transcribe()
        print("\n✅ All STT tests passed!")
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
