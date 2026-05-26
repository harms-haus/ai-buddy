"""STT Service — faster-whisper with Wyoming protocol for Home Assistant integration"""

import os
import asyncio
import tempfile
import wave
import time
from functools import partial

from dotenv import load_dotenv
from faster_whisper import WhisperModel

import ctranslate2

from wyoming.server import AsyncServer, AsyncEventHandler
from wyoming.asr import Transcribe, Transcript
from wyoming.audio import AudioStart, AudioChunk, AudioStop, AudioChunkConverter
from wyoming.error import Error
from wyoming.info import Info, AsrProgram, AsrModel, Attribution, Describe

try:
    from wyoming.zeroconf import HomeAssistantZeroconf
    HAS_ZEROCONF = True
except ImportError:
    HAS_ZEROCONF = False

# ---------------------------------------------------------------------------
# GPU auto-detection
# ---------------------------------------------------------------------------

def _get_free_gpu_memory_mib():
    """Return free GPU memory in MiB using nvidia-smi, or 0 on failure."""
    import subprocess
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        return int(result.stdout.strip().split("\n")[0])
    except Exception:
        return 0


def get_device_and_compute():
    """Auto-detect GPU and return (device, compute_type).

    Uses CUDA when available AND there is enough free GPU memory.
    Falls back to CPU/int8 when GPU memory is scarce (e.g., shared
    with a large TTS model). CPU/int8 is still fast enough for real-time.
    """
    if ctranslate2.get_cuda_device_count() > 0:
        free_mib = _get_free_gpu_memory_mib()
        free_gib = free_mib / 1024
        # Whisper medium.en needs ~2 GiB; require 3 GiB free for headroom
        if free_gib >= 3.0:
            print(f"[STT] CUDA available ({free_gib:.1f} GiB free, {ctranslate2.get_cuda_device_count()} device(s))")
            return "cuda", "float16"
        else:
            print(f"[STT] GPU detected but only {free_gib:.1f} GiB free — using CPU to save GPU memory for TTS")
    print("[STT] CUDA not available, using CPU")
    return "cpu", "int8"

# ---------------------------------------------------------------------------
# Wyoming event handler
# ---------------------------------------------------------------------------

# 60 seconds of 16 kHz 16-bit mono audio
MAX_AUDIO_BYTES = 16000 * 2 * 1 * 60  # 1_920_000


class SttEventHandler(AsyncEventHandler):
    """Handles a single Wyoming client connection for STT."""

    def __init__(self, info_event, whisper_model, gpu_sem, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._info_event = info_event
        self._model = whisper_model
        self._gpu_sem = gpu_sem
        self._audio_converter: AudioChunkConverter | None = None
        self._wav_dir: tempfile.TemporaryDirectory | None = None
        self._wav_path: str | None = None
        self._wav_file: wave.Wave_write | None = None
        self._audio_bytes_written: int = 0
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
                self._wav_dir = tempfile.TemporaryDirectory()
                self._wav_path = os.path.join(self._wav_dir.name, "speech.wav")
                self._wav_file = wave.open(self._wav_path, "wb")
                self._wav_file.setframerate(chunk.rate)
                self._wav_file.setsampwidth(chunk.width)
                self._wav_file.setnchannels(chunk.channels)
            self._wav_file.writeframes(chunk.audio)
            self._audio_bytes_written += len(chunk.audio)
            if self._audio_bytes_written > MAX_AUDIO_BYTES:
                await self.write_event(
                    Error(text="Audio exceeds maximum duration").event()
                )
                return False
            return True

        # AudioStop → transcribe and return result
        if AudioStop.is_type(event.type):
            try:
                if self._wav_file:
                    self._wav_file.close()
                    self._wav_file = None

                t_start = time.perf_counter()

                async with self._gpu_sem:
                    text, info = await asyncio.to_thread(
                        self._transcribe, self._wav_path
                    )

                await self.write_event(
                    Transcript(text=text, language=info.language).event()
                )

                elapsed = time.perf_counter() - t_start
                print(f"[STT] transcription complete | audio={info.duration:.1f}s | vad_audio={info.duration_after_vad:.1f}s | elapsed={elapsed:.2f}s | chars={len(text)} | text={text!r}")
            finally:
                if self._wav_file is not None:
                    self._wav_file.close()
                    self._wav_file = None
                if self._wav_dir is not None:
                    self._wav_dir.cleanup()
                    self._wav_dir = None
                    self._wav_path = None
                self._audio_bytes_written = 0
                self._language = None
            return False  # disconnect

        return True

    async def disconnect(self) -> None:
        """Cleanup on client disconnect."""
        if self._wav_file is not None:
            self._wav_file.close()
            self._wav_file = None
        if self._wav_dir is not None:
            self._wav_dir.cleanup()

    def _transcribe(self, wav_path: str) -> str:
        """Run Whisper transcription (blocking – call via to_thread)."""
        segments, info = self._model.transcribe(
            wav_path,
            beam_size=5,
            language="en",
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
        )
        text = " ".join(seg.text for seg in segments).strip()
        return text, info

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
            await zeroconf._aiozc.async_close()


if __name__ == "__main__":
    asyncio.run(main())
