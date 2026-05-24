"""TTS Service — Kokoro ONNX with Wyoming protocol for Home Assistant."""

import os
import asyncio
import math
from functools import partial

from dotenv import load_dotenv
import numpy as np

from wyoming.server import AsyncServer, AsyncEventHandler
from wyoming.tts import Synthesize
from wyoming.audio import AudioStart, AudioChunk, AudioStop
from wyoming.info import Info, TtsProgram, TtsVoice, Attribution, Describe
from wyoming.event import Event

try:
    from wyoming.zeroconf import HomeAssistantZeroconf
    HAS_ZEROCONF = True
except ImportError:
    HAS_ZEROCONF = False

SAMPLES_PER_CHUNK = 1024
RATE = 24000
WIDTH = 2  # 16-bit = 2 bytes
CHANNELS = 1


def _download_if_missing(path: str) -> None:
    """Download a Kokoro model file from GitHub if it doesn't exist locally."""
    if os.path.exists(path):
        return
    import requests
    url = f"https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/{os.path.basename(path)}"
    print(f"Downloading {url}...")
    r = requests.get(url, stream=True)
    r.raise_for_status()
    with open(path, "wb") as f:
        for chunk in r.iter_content(chunk_size=8192):
            f.write(chunk)


def load_pipeline():
    """Load Kokoro ONNX pipeline, auto-downloading model/voices if missing."""
    model_path = os.getenv("KOKORO_MODEL_PATH", "kokoro-v1.0.onnx")
    voices_path = os.getenv("KOKORO_VOICES_PATH", "voices-v1.0.bin")

    _download_if_missing(model_path)
    _download_if_missing(voices_path)

    from kokoro_onnx import Kokoro
    pipeline = Kokoro(model_path, voices_path)
    voices = pipeline.get_voices()
    return pipeline, voices


def build_info_event(available_voices):
    """Build the Wyoming Info event describing this TTS server."""
    wyoming_info = Info(
        tts=[TtsProgram(
            name="kokoro",
            description="Kokoro TTS (ONNX)",
            attribution=Attribution(
                name="thewh1teagle",
                url="https://github.com/thewh1teagle/kokoro-onnx",
            ),
            installed=True,
            version=None,
            voices=[
                TtsVoice(
                    name=v,
                    description=v,
                    attribution=Attribution(
                        name="thewh1teagle",
                        url="https://github.com/thewh1teagle/kokoro-onnx",
                    ),
                    installed=True,
                    version=None,
                    languages=["en"],
                )
                for v in available_voices
            ],
            supports_synthesize_streaming=True,
        )]
    )
    return wyoming_info.event()


class TtsEventHandler(AsyncEventHandler):
    """Handles Wyoming TTS events: Describe and Synthesize."""

    def __init__(self, info_event, pipeline, default_voice, default_speed, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._info_event = info_event
        self._pipeline = pipeline
        self._default_voice = default_voice
        self._default_speed = default_speed

    async def handle_event(self, event: Event) -> bool:
        # Describe → send Info
        if Describe.is_type(event.type):
            await self.write_event(self._info_event)
            return True

        # Synthesize → generate and stream audio
        if Synthesize.is_type(event.type):
            synthesize = Synthesize.from_event(event)
            text = synthesize.text
            voice = synthesize.voice.name if synthesize.voice else self._default_voice
            speed = self._default_speed  # Wyoming doesn't pass speed, use default

            try:
                # Send AudioStart
                await self.write_event(
                    AudioStart(rate=RATE, width=WIDTH, channels=CHANNELS).event()
                )

                # Use create_stream for sentence-by-sentence synthesis
                async for chunk_audio, sr in self._pipeline.create_stream(
                    text, voice=voice, speed=speed
                ):
                    # Convert float32 → int16 PCM bytes
                    pcm = (np.clip(chunk_audio, -1.0, 1.0) * 32767).astype(np.int16).tobytes()

                    # Split into sub-chunks of SAMPLES_PER_CHUNK samples
                    bytes_per_chunk = WIDTH * CHANNELS * SAMPLES_PER_CHUNK
                    for i in range(math.ceil(len(pcm) / bytes_per_chunk)):
                        sub_chunk = pcm[i * bytes_per_chunk : (i + 1) * bytes_per_chunk]
                        await self.write_event(
                            AudioChunk(
                                audio=sub_chunk,
                                rate=RATE,
                                width=WIDTH,
                                channels=CHANNELS,
                            ).event()
                        )

                # Send AudioStop
                await self.write_event(AudioStop().event())

            except Exception as err:
                from wyoming.error import Error
                await self.write_event(
                    Error(text=str(err), code=err.__class__.__name__).event()
                )
                raise

            return False  # disconnect after synthesis

        return True


async def main():
    load_dotenv()
    port = int(os.getenv("TTS_PORT", "10201"))
    host = os.getenv("TTS_HOST", "0.0.0.0")
    default_voice = os.getenv("KOKORO_VOICE", "af_heart")
    default_speed = float(os.getenv("KOKORO_SPEED", "1.0"))

    print("Loading Kokoro TTS pipeline...")
    pipeline, voices = load_pipeline()
    print(f"Loaded {len(voices)} voices: {', '.join(voices[:5])}...")

    info_event = build_info_event(voices)

    server = AsyncServer.from_uri(f"tcp://{host}:{port}")
    print(f"TTS Wyoming server starting on {host}:{port}")

    zeroconf = None
    if HAS_ZEROCONF:
        zeroconf = HomeAssistantZeroconf(port, name="kids-agent-tts")
        await zeroconf.register_server()
        print(f"Zeroconf registered: kids-agent-tts on port {port}")

    try:
        await server.run(partial(
            TtsEventHandler, info_event, pipeline, default_voice, default_speed
        ))
    finally:
        if zeroconf:
            await zeroconf.unregister_server()


if __name__ == "__main__":
    asyncio.run(main())
