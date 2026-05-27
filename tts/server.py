"""TTS Service — Kokoro ONNX with Wyoming protocol for Home Assistant."""

import os
import asyncio
import time
from abc import ABC, abstractmethod
from functools import partial
from typing import AsyncGenerator

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

SAMPLES_PER_CHUNK = 8192
RATE = 24000
WIDTH = 2  # 16-bit = 2 bytes
CHANNELS = 1


def _float32_to_pcm_bytes(audio: np.ndarray) -> bytes:
    """Convert float32 audio array to int16 PCM bytes."""
    clipped = np.clip(audio, -1.0, 1.0)
    pcm = (clipped * 32767).astype(np.int16)
    return pcm.tobytes()


def _split_pcm_chunks(pcm: bytes):
    """Split PCM bytes into sub-chunks for Wyoming AudioChunk events."""
    chunk_size = WIDTH * CHANNELS * SAMPLES_PER_CHUNK
    for i in range(0, len(pcm), chunk_size):
        yield pcm[i:i + chunk_size]


def _download_file(path: str, base_url: str) -> None:
    """Download a file from base_url if it doesn't exist locally."""
    if os.path.exists(path):
        return
    import requests
    url = f"{base_url}/{os.path.basename(path)}"
    print(f"Downloading {url}...")
    r = requests.get(url, stream=True)
    r.raise_for_status()
    with open(path, "wb") as f:
        for chunk in r.iter_content(chunk_size=8192):
            f.write(chunk)


class TtsBackend(ABC):
    """Abstract base class for TTS backend engines."""

    @abstractmethod
    def get_voices(self) -> list[str]:
        """Return list of available voice names."""
        ...

    @abstractmethod
    def get_info(self) -> tuple[str, str, str]:
        """Return (name, description, attribution_url) for Wyoming Info event."""
        ...

    @abstractmethod
    def get_audio_format(self) -> tuple[int, int, int]:
        """Return (sample_rate, sample_width, channels)."""
        ...

    @abstractmethod
    async def synthesize(self, text: str, voice: str, speed: float) -> AsyncGenerator[bytes, None]:
        """Synthesize text to speech. Yields int16 PCM byte chunks."""
        ...


class KokoroBackend(TtsBackend):
    """Kokoro ONNX TTS backend."""

    _KOKORO_BASE_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"

    def __init__(self):
        model_path = os.getenv("KOKORO_MODEL_PATH", "kokoro-v1.0.onnx")
        voices_path = os.getenv("KOKORO_VOICES_PATH", "voices-v1.0.bin")

        for path in [model_path, voices_path]:
            _download_file(path, self._KOKORO_BASE_URL)

        from kokoro_onnx import Kokoro
        self._pipeline = Kokoro(model_path, voices_path)
        self._voices = self._pipeline.get_voices()

    def get_voices(self) -> list[str]:
        return self._voices

    def get_info(self) -> tuple[str, str, str]:
        return ("kokoro", "Kokoro TTS (ONNX)", "https://github.com/thewh1teagle/kokoro-onnx")

    def get_audio_format(self) -> tuple[int, int, int]:
        return (RATE, WIDTH, CHANNELS)

    async def synthesize(self, text: str, voice: str, speed: float) -> AsyncGenerator[bytes, None]:
        async for chunk_audio, _sr in self._pipeline.create_stream(text, voice=voice, speed=speed):
            pcm = _float32_to_pcm_bytes(chunk_audio)
            for sub_chunk in _split_pcm_chunks(pcm):
                yield sub_chunk


class ChatTTSBackend(TtsBackend):
    """ChatTTS backend (2noise). Non-commercial license."""

    def __init__(self):
        try:
            import ChatTTS
        except ImportError:
            raise RuntimeError(
                "ChatTTS is not installed.\n"
                "Install with: pip install ChatTTS"
            )

        print("WARNING: ChatTTS is licensed AGPLv3+ (code) + CC-BY-NC 4.0 (model). Non-commercial use only.")

        self._chat = ChatTTS.Chat()
        self._chat.load(compile=False)

        self._temperature = float(os.getenv("CHATTTS_TEMPERATURE", "0.3"))
        self._refine_prompt = os.getenv("CHATTTS_REFINE_PROMPT", "[oral_2][laugh_0][break_4]")

        # Generate default speaker embedding
        self._default_speaker = self._chat.sample_random_speaker()

        # Serialize GPU inference to prevent OOM from concurrent requests
        self._semaphore = asyncio.Semaphore(1)

    def get_voices(self) -> list[str]:
        return ["random"]

    def get_info(self) -> tuple[str, str, str]:
        return ("chattts", "ChatTTS (2noise)", "https://github.com/2noise/ChatTTS")

    def get_audio_format(self) -> tuple[int, int, int]:
        return (RATE, WIDTH, CHANNELS)  # 24000

    async def synthesize(self, text: str, voice: str, speed: float) -> AsyncGenerator[bytes, None]:
        import ChatTTS

        params_infer = ChatTTS.Chat.InferCodeParams(
            spk_emb=self._default_speaker,
            temperature=self._temperature,
        )
        params_refine = ChatTTS.Chat.RefineTextParams(
            prompt=self._refine_prompt,
        )

        # Run in thread (blocking call), serialized via semaphore
        async with self._semaphore:
            loop = asyncio.get_running_loop()
            wavs = await loop.run_in_executor(
                None,
                lambda: self._chat.infer(
                    [text],
                    params_infer_code=params_infer,
                    params_refine_text=params_refine,
                )
            )

        # wavs is a list of numpy arrays
        for wav in wavs:
            audio = wav.squeeze().astype(np.float32)
            pcm = _float32_to_pcm_bytes(audio)
            for chunk in _split_pcm_chunks(pcm):
                yield chunk


class DiaBackend(TtsBackend):
    """Dia TTS backend (Nari Labs)."""

    DIA_SAMPLE_RATE = 44100  # Dia's native output rate

    def __init__(self):
        try:
            from dia.model import Dia
        except ImportError:
            raise RuntimeError(
                "dia is not installed.\n"
                "Install with: pip install git+https://github.com/nari-labs/dia.git"
            )

        import torch
        device = os.getenv("DIA_DEVICE", "cuda")

        # Warn if no GPU
        if device == "cuda" and not torch.cuda.is_available():
            print("WARNING: Dia requires GPU (CUDA). Performance on CPU will be very poor.")
            device = "cpu"

        model_id = os.getenv("DIA_MODEL", "nari-labs/Dia-1.6B-0626")
        print(f"Loading Dia model ({model_id}) on {device}...")
        self._model = Dia.from_pretrained(model_id, compute_dtype='float16', device=device)

        # Voice files
        self._voices_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "voices")
        self._voices = []
        if os.path.isdir(self._voices_dir):
            self._voices = sorted([f[:-4] for f in os.listdir(self._voices_dir) if f.endswith(".wav")])
        if not self._voices:
            self._voices = ["random"]
            print("WARNING: No reference audio in tts/voices/. Dia will use random voices.")

        # Serialize GPU inference to prevent OOM from concurrent requests
        self._semaphore = asyncio.Semaphore(1)

    def get_voices(self) -> list[str]:
        return self._voices

    def get_info(self) -> tuple[str, str, str]:
        return ("dia", "Dia TTS (Nari Labs)", "https://github.com/nari-labs/dia")

    def get_audio_format(self) -> tuple[int, int, int]:
        return (RATE, WIDTH, CHANNELS)  # 24000 after resampling

    def _generate_and_process(self, dialogue: str) -> np.ndarray:
        """Generate audio and resample — runs entirely in executor to avoid blocking."""
        import torch
        import torchaudio.functional as AF

        audio = self._model.generate(dialogue)

        # Convert to tensor if needed
        if hasattr(audio, 'cpu') and hasattr(audio, 'numpy'):
            audio = audio.squeeze().cpu()
        elif isinstance(audio, np.ndarray):
            audio = torch.from_numpy(audio).float()
            if audio.ndim > 1:
                audio = audio.squeeze()

        # Resample from 44100 to 24000 inside executor
        resampled = AF.resample(audio.float(), orig_freq=self.DIA_SAMPLE_RATE, new_freq=RATE)
        return resampled.numpy().astype(np.float32)

    async def synthesize(self, text: str, voice: str, speed: float) -> AsyncGenerator[bytes, None]:
        # Validate voice name (prevent path traversal)
        if voice and ("/" in voice or "\\" in voice or ".." in voice or voice.startswith(".")):
            raise ValueError(f"Invalid voice name: {voice!r}")

        # Wrap text with [S1] speaker tag for single-speaker output
        dialogue = f"[S1] {text}"

        # Generate and post-process in thread (blocking calls), serialized via semaphore
        async with self._semaphore:
            loop = asyncio.get_running_loop()
            audio = await loop.run_in_executor(
                None,
                lambda: self._generate_and_process(dialogue)
            )

        pcm = _float32_to_pcm_bytes(audio)
        for chunk in _split_pcm_chunks(pcm):
            yield chunk


class ChatterboxBackend(TtsBackend):
    """Chatterbox TTS backend (Resemble AI)."""

    def __init__(self):
        try:
            from chatterbox.tts_turbo import ChatterboxTurboTTS
        except ImportError:
            raise RuntimeError(
                "chatterbox-tts is not installed.\n"
                "Install with: pip install chatterbox-tts"
            )

        import torch
        device = os.getenv("CHATTERBOX_DEVICE")
        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
        self._exaggeration = float(os.getenv("CHATTERBOX_EXAGGERATION", "0.5"))
        self._cfg_weight = float(os.getenv("CHATTERBOX_CFG_WEIGHT", "0.0"))
        self._temperature = float(os.getenv("CHATTERBOX_TEMPERATURE", "0.8"))

        print(f"Loading Chatterbox model on {device}...")
        self._model = ChatterboxTurboTTS.from_pretrained(device=device)
        self._sample_rate = self._model.sr  # 24000

        # Scan voices directory for reference audio files
        self._voices_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "voices")
        self._voices = []
        self._voice_paths: dict[str, str] = {}
        if os.path.isdir(self._voices_dir):
            for f in sorted(os.listdir(self._voices_dir)):
                if f.endswith(".wav"):
                    name = f[:-4]
                    self._voices.append(name)
                    self._voice_paths[name] = os.path.join(self._voices_dir, f)
        if not self._voices:
            self._voices = ["default"]
            print("WARNING: No reference audio files found in tts/voices/. Using built-in default.")
            print("Add .wav files (>= 5s clean speech) to tts/voices/ for voice cloning.")

        # Serialize GPU inference to prevent OOM from concurrent requests
        self._semaphore = asyncio.Semaphore(1)

    def get_voices(self) -> list[str]:
        return self._voices

    def get_info(self) -> tuple[str, str, str]:
        return ("chatterbox", "Chatterbox TTS (Resemble AI)", "https://github.com/resemble-ai/chatterbox")

    def get_audio_format(self) -> tuple[int, int, int]:
        return (self._sample_rate, WIDTH, CHANNELS)

    async def synthesize(self, text: str, voice: str, speed: float) -> AsyncGenerator[bytes, None]:
        # Validate voice name (prevent path traversal)
        if voice and ("/" in voice or "\\" in voice or ".." in voice or voice.startswith(".")):
            raise ValueError(f"Invalid voice name: {voice!r}")

        # Resolve reference audio path
        ref_path = self._voice_paths.get(voice)
        if ref_path is None and self._voice_paths:
            ref_path = next(iter(self._voice_paths.values()))
        if ref_path is None:
            raise RuntimeError("No reference audio found. Add .wav files to tts/voices/ directory.")

        # Generate in thread (blocking call), serialized via semaphore
        async with self._semaphore:
            loop = asyncio.get_running_loop()
            wav = await loop.run_in_executor(
                None,
                lambda: self._model.generate(
                    text,
                    audio_prompt_path=ref_path,
                    exaggeration=self._exaggeration,
                    cfg_weight=self._cfg_weight,
                    temperature=self._temperature,
                )
            )

        # Convert torch tensor to PCM bytes
        audio = wav.squeeze().cpu().numpy().astype(np.float32)
        pcm = _float32_to_pcm_bytes(audio)
        for chunk in _split_pcm_chunks(pcm):
            yield chunk


def _create_backend(name: str) -> TtsBackend:
    """Factory function to create a TTS backend by name."""
    if name == "kokoro":
        try:
            return KokoroBackend()
        except ImportError:
            raise RuntimeError("kokoro-onnx is not installed. Run: pip install kokoro-onnx")
    elif name == "chatterbox":
        return ChatterboxBackend()
    elif name == "dia":
        return DiaBackend()
    elif name == "chattts":
        return ChatTTSBackend()
    else:
        raise ValueError(f"Unknown TTS backend: '{name}'. Valid options: kokoro, chatterbox, dia, chattts")


def build_info_event(backend: TtsBackend) -> Event:
    """Build the Wyoming Info event describing this TTS server."""
    name, description, attr_url = backend.get_info()
    voices = backend.get_voices()
    wyoming_info = Info(
        tts=[TtsProgram(
            name=name,
            description=description,
            attribution=Attribution(name=name, url=attr_url),
            installed=True,
            version=None,
            voices=[
                TtsVoice(
                    name=v,
                    description=v,
                    attribution=Attribution(name=name, url=attr_url),
                    installed=True,
                    version=None,
                    languages=["en"],
                )
                for v in voices
            ],
            supports_synthesize_streaming=True,
        )]
    )
    return wyoming_info.event()


class TtsEventHandler(AsyncEventHandler):
    """Handles Wyoming TTS events: Describe and Synthesize."""

    def __init__(self, info_event, backend: TtsBackend, default_voice, default_speed, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._info_event = info_event
        self._backend = backend
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
            t_start = time.perf_counter()

            if len(text) > 5000:
                from wyoming.error import Error
                await self.write_event(Error(text="Text too long (max 5000 chars)", code="InputTooLong").event())
                return False

            print(f"[TTS] synthesis starting | chars={len(text)} | voice={voice} | text={text!r}")

            try:
                rate, width, channels = self._backend.get_audio_format()

                # Send AudioStart
                await self.write_event(
                    AudioStart(rate=rate, width=width, channels=channels).event()
                )

                # Collect all PCM chunks into a single buffer, then send
                # as one AudioChunk + AudioStop. HA's voice pipeline expects
                # a single audio segment — streaming multiple chunks causes it
                # to transition to STT (listen mode) before playback finishes.
                pcm_chunks: list[bytes] = []
                async for pcm_chunk in self._backend.synthesize(
                    text, voice=voice, speed=speed
                ):
                    pcm_chunks.append(pcm_chunk)

                pcm_all = b''.join(pcm_chunks)
                total_bytes = len(pcm_all)
                audio_duration = total_bytes / (rate * width * channels)

                # Send the complete audio as a single chunk
                await self.write_event(AudioChunk(
                    audio=pcm_all, width=width, channels=channels, rate=rate
                ).event())

                # Send AudioStop
                await self.write_event(AudioStop().event())

                elapsed = time.perf_counter() - t_start
                print(f"[TTS] synthesis complete | elapsed={elapsed:.2f}s | audio={audio_duration:.1f}s | chars={len(text)} | text={text!r}")

            except Exception as err:
                import sys
                from wyoming.error import Error
                print(f"[TTS] Error: {err}", file=sys.stderr)
                await self.write_event(
                    Error(text="Synthesis failed", code="SynthesisError").event()
                )
                raise

            return False  # disconnect after synthesis

        return True


async def main():
    load_dotenv()
    port = int(os.getenv("TTS_PORT", "10201"))
    host = os.getenv("TTS_HOST", "127.0.0.1")
    backend_name = os.getenv("TTS_BACKEND", "kokoro")

    print(f"Loading {backend_name} TTS backend...")
    backend = _create_backend(backend_name)
    voices = backend.get_voices()

    # Report CUDA status (mirrors STT startup banner)
    try:
        import torch
        if torch.cuda.is_available():
            _dev_name = torch.cuda.get_device_name(0)
            _free_mib = torch.cuda.mem_get_info()[0] / (1024 ** 2)
            print(f"[TTS] CUDA available ({_dev_name}, {_free_mib:.0f} MiB free)")
        else:
            print("[TTS] CUDA not available, using CPU")
    except ImportError:
        print("[TTS] PyTorch not installed, using CPU")

    print(f"{backend_name} backend loaded. Voices: {', '.join(voices[:5])}{'...' if len(voices) > 5 else ''}")

    # Backward-compat: KOKORO_VOICE/TTS_VOICE, KOKORO_SPEED/TTS_SPEED
    default_voice = os.getenv("TTS_VOICE") or os.getenv("KOKORO_VOICE") or voices[0]
    default_speed = float(os.getenv("TTS_SPEED") or os.getenv("KOKORO_SPEED", "1.0"))

    info_event = build_info_event(backend)
    server = AsyncServer.from_uri(f"tcp://{host}:{port}")
    print(f"TTS Wyoming server ({backend_name}) starting on {host}:{port}")

    zeroconf = None
    if HAS_ZEROCONF:
        zeroconf = HomeAssistantZeroconf(port=port, name=f"ai-buddy-tts-{backend_name}")
        await zeroconf.register_server()
        print(f"Zeroconf registered: ai-buddy-tts-{backend_name} on port {port}")

    try:
        await server.run(partial(
            TtsEventHandler, info_event, backend, default_voice, default_speed,
        ))
    finally:
        if zeroconf:
            await zeroconf._aiozc.async_close()


if __name__ == "__main__":
    asyncio.run(main())
