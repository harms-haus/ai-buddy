"""STT Service — faster-whisper with Wyoming protocol for Home Assistant integration"""

import os
import asyncio
import tempfile
import wave
from functools import partial

from dotenv import load_dotenv
from faster_whisper import WhisperModel

try:
    import torch
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False

from wyoming.server import AsyncServer, AsyncEventHandler
from wyoming.asr import Transcribe, Transcript
from wyoming.audio import AudioStart, AudioChunk, AudioStop, AudioChunkConverter
from wyoming.info import Info, AsrProgram, AsrModel, Attribution, Describe

try:
    from wyoming.zeroconf import HomeAssistantZeroconf
    HAS_ZEROCONF = True
except ImportError:
    HAS_ZEROCONF = False

# ---------------------------------------------------------------------------
# GPU auto-detection
# ---------------------------------------------------------------------------

def get_device_and_compute():
    """Auto-detect GPU and return (device, compute_type)."""
    if HAS_TORCH and torch.cuda.is_available():
        print(f"[STT] CUDA available: {torch.cuda.get_device_name(0)}")
        return "cuda", "float16"
    print("[STT] CUDA not available, using CPU")
    return "cpu", "int8"

# ---------------------------------------------------------------------------
# Wyoming event handler
# ---------------------------------------------------------------------------

class SttEventHandler(AsyncEventHandler):
    """Handles a single Wyoming client connection for STT."""

    def __init__(self, info_event, whisper_model, gpu_sem, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._info_event = info_event
        self._model = whisper_model
        self._gpu_sem = gpu_sem
        self._audio_converter: AudioChunkConverter | None = None
        self._wav_dir = tempfile.TemporaryDirectory()
        self._wav_path = os.path.join(self._wav_dir.name, "speech.wav")
        self._wav_file: wave.Wave_write | None = None
        self._language: str | None = None

    async def handle_event(self, event) -> bool:
        # Describe → send Info
        if Describe.is_type(event.type):
            await self.write_event(self._info_event)
            return True

        # Transcribe → store language
        if Transcribe.is_type(event.type):
            transcribe = Transcribe.from_event(event)
            self._language = transcribe.language
            return True

        # AudioStart → prepare converter
        if AudioStart.is_type(event.type):
            audio_start = AudioStart.from_event(event)
            self._audio_converter = AudioChunkConverter(
                rate=16000, width=2, channels=1
            )
            return True

        # AudioChunk → convert and write to WAV
        if AudioChunk.is_type(event.type):
            chunk = AudioChunk.from_event(event)
            if self._audio_converter:
                chunk = self._audio_converter.convert(chunk)
            if self._wav_file is None:
                self._wav_file = wave.open(self._wav_path, "wb")
                self._wav_file.setframerate(chunk.rate)
                self._wav_file.setsampwidth(chunk.width)
                self._wav_file.setnchannels(chunk.channels)
            self._wav_file.writeframes(chunk.audio)
            return True

        # AudioStop → transcribe and return result
        if AudioStop.is_type(event.type):
            if self._wav_file:
                self._wav_file.close()
                self._wav_file = None

            async with self._gpu_sem:
                text = await asyncio.to_thread(
                    self._transcribe, self._wav_path
                )

            await self.write_event(
                Transcript(text=text, language=self._language or "en").event()
            )
            # Reset state
            self._language = None
            return False  # disconnect

        return True

    def _transcribe(self, wav_path: str) -> str:
        """Run Whisper transcription (blocking – call via to_thread)."""
        segments, info = self._model.transcribe(
            wav_path,
            beam_size=5,
            language="en",
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
        )
        return " ".join(seg.text for seg in segments).strip()

# ---------------------------------------------------------------------------
# Server entry-point
# ---------------------------------------------------------------------------

async def main():
    load_dotenv()
    port = int(os.getenv("STT_PORT", "10200"))
    host = os.getenv("STT_HOST", "0.0.0.0")
    model_name = os.getenv("WHISPER_MODEL", "medium.en")

    device, compute_type = get_device_and_compute()
    print(f"[STT] Loading Whisper model '{model_name}' on {device}/{compute_type}...")
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    print("[STT] Model loaded.")

    gpu_sem = asyncio.Semaphore(1)

    # Pre-compute info event (sent in response to Describe)
    wyoming_info = Info(
        asr=[AsrProgram(
            name="faster-whisper",
            description="Faster Whisper STT with CTranslate2",
            attribution=Attribution(
                name="guillaumekln",
                url="https://github.com/guillaumekln/faster-whisper",
            ),
            installed=True,
            version="1.0.0",
            models=[AsrModel(
                name=model_name,
                description=f"Faster Whisper {model_name}",
                attribution=Attribution(
                    name="Systran",
                    url="https://huggingface.co/Systran",
                ),
                installed=True,
                version="1.0.0",
                languages=["en"],
            )],
        )]
    )
    info_event = wyoming_info.event()

    server = AsyncServer.from_uri(f"tcp://{host}:{port}")
    print(f"[STT] Wyoming server starting on {host}:{port}")

    zeroconf = None
    if HAS_ZEROCONF:
        zeroconf = HomeAssistantZeroconf(port=port, name="kids-agent-stt")
        await zeroconf.register_server()
        print(f"[STT] Zeroconf registered: kids-agent-stt on port {port}")

    try:
        await server.run(partial(SttEventHandler, info_event, model, gpu_sem))
    finally:
        if zeroconf:
            await zeroconf.unregister_server()


if __name__ == "__main__":
    asyncio.run(main())
