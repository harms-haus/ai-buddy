#!/usr/bin/env python3
"""Integration test: Agent → TTS → STT round-trip."""

import asyncio
import sys
import requests

from wyoming.client import AsyncClient
from wyoming.tts import Synthesize
from wyoming.asr import Transcribe, Transcript
from wyoming.audio import AudioStart, AudioChunk, AudioStop

AGENT_URL = "http://localhost:4111"
TTS_URI = "tcp://localhost:10201"
STT_URI = "tcp://localhost:10200"


def query_agent(text: str) -> str:
    """Query the Mastra agent via HTTP."""
    resp = requests.post(
        f"{AGENT_URL}/api/agents/kids-agent/generate",
        json={"messages": [{"role": "user", "content": text}]},
    )
    resp.raise_for_status()
    return resp.json()["text"]


async def tts_synthesize(text: str) -> tuple[bytes, int, int, int]:
    """Synthesize text via Wyoming TTS. Returns (pcm_bytes, rate, width, channels)."""
    client = AsyncClient.from_uri(TTS_URI)
    await client.connect()
    await client.write_event(Synthesize(text=text).event())

    chunks = []
    rate = width = channels = None
    while True:
        event = await client.read_event()
        if AudioStart.is_type(event.type):
            s = AudioStart.from_event(event)
            rate, width, channels = s.rate, s.width, s.channels
        elif AudioChunk.is_type(event.type):
            chunks.append(AudioChunk.from_event(event).audio)
        elif AudioStop.is_type(event.type):
            break
    await client.disconnect()
    return b"".join(chunks), rate, width, channels


async def stt_transcribe(pcm: bytes, rate: int, width: int, channels: int) -> str:
    """Transcribe audio via Wyoming STT."""
    client = AsyncClient.from_uri(STT_URI)
    await client.connect()
    await client.write_event(Transcribe(language="en").event())
    await client.write_event(AudioStart(rate=rate, width=width, channels=channels).event())

    chunk_size = 4096
    for i in range(0, len(pcm), chunk_size):
        await client.write_event(
            AudioChunk(audio=pcm[i:i+chunk_size], rate=rate, width=width, channels=channels).event()
        )
    await client.write_event(AudioStop().event())

    event = await client.read_event()
    assert Transcript.is_type(event.type)
    text = Transcript.from_event(event).text
    await client.disconnect()
    return text


async def main():
    print("=== Integration Test: Agent → TTS → STT ===\n")
    try:
        # Step 1: Query agent
        print("1. Querying agent...")
        agent_text = query_agent("Say hello in one short sentence.")
        print(f"   Agent: {agent_text}")

        # Step 2: TTS
        print("2. Synthesizing speech...")
        pcm, rate, width, channels = await tts_synthesize(agent_text)
        print(f"   Audio: {len(pcm)} bytes, {rate}Hz, {width*8}bit, {channels}ch")

        # Step 3: STT
        print("3. Transcribing back...")
        result = await stt_transcribe(pcm, rate, width, channels)
        print(f"   Transcript: {result}")

        print("\n✅ Integration test complete!")
    except Exception as e:
        print(f"\n❌ Integration test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
