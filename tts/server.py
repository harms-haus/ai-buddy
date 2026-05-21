"""TTS Service — Kokoro with FastAPI"""

import io
import os
from contextlib import asynccontextmanager

import numpy as np
import soundfile as sf
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

load_dotenv()

TTS_PORT = int(os.getenv("TTS_PORT", "5001"))
TTS_HOST = os.getenv("TTS_HOST", "0.0.0.0")
DEFAULT_VOICE = os.getenv("KOKORO_VOICE", "af_heart")
DEFAULT_SPEED = float(os.getenv("KOKORO_SPEED", "1.0"))

pipeline = None
available_voices = []
SAMPLE_RATE = 24000
CHUNK_SIZE = 64 * 1024  # 64KB chunks for streaming


def try_load_kokoro():
    """Try to load Kokoro, return (pipeline, voices_list)."""
    # Try kokoro package first (KPipeline)
    try:
        from kokoro import KPipeline
        print("[TTS] Loading Kokoro KPipeline...")
        p = KPipeline(lang_code='a')
        voices = [
            'af_heart', 'af_sky', 'af_sarah', 'af_nicole',
            'af_bella', 'am_michael', 'am_adam', 'am_adam',
        ]
        # Try to get actual voices from pipeline if available
        if hasattr(p, 'get_voices'):
            try:
                voices = sorted(p.get_voices().keys())
            except:
                pass
        print(f"[TTS] Kokoro KPipeline loaded. Voices: {voices[:5]}...")
        return p, voices, 'kpipeline'
    except ImportError:
        pass
    except Exception as e:
        print(f"[TTS] KPipeline failed: {e}")
    
    # Fallback: kokoro-onnx
    try:
        from kokoro_onnx import Kokoro
        print("[TTS] Loading Kokoro ONNX...")
        
        model_path = os.getenv("KOKORO_MODEL_PATH", "kokoro-v1.0.onnx")
        voices_path = os.getenv("KOKORO_VOICES_PATH", "voices-v1.0.bin")
        
        # Auto-download if not present
        if not os.path.exists(model_path):
            print(f"[TTS] Downloading model to {model_path}...")
            import requests
            url = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
            r = requests.get(url)
            with open(model_path, 'wb') as f:
                f.write(r.content)
        
        if not os.path.exists(voices_path):
            print(f"[TTS] Downloading voices to {voices_path}...")
            import requests
            url = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"
            r = requests.get(url)
            with open(voices_path, 'wb') as f:
                f.write(r.content)
        
        p = Kokoro(model_path=model_path, voices_path=voices_path)
        voices = sorted(p.get_voices())
        print(f"[TTS] Kokoro ONNX loaded. Voices: {voices[:5]}...")
        return p, voices, 'kokoro_onnx'
    except ImportError:
        pass
    except Exception as e:
        print(f"[TTS] Kokoro ONNX failed: {e}")
    
    raise RuntimeError("Could not load any Kokoro backend. Install kokoro or kokoro-onnx.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global pipeline, available_voices
    pipeline, available_voices, backend = try_load_kokoro()
    print(f"[TTS] Ready! Backend: {backend}, Voices: {len(available_voices)}")
    yield
    del pipeline
    pipeline = None
    print("[TTS] Unloaded")


app = FastAPI(
    title="Kids Agent TTS Service",
    description="Text-to-speech using Kokoro",
    version="0.1.0",
    lifespan=lifespan,
)


class TTSRequest(BaseModel):
    text: str = Field(..., max_length=1000)
    voice: str = DEFAULT_VOICE
    speed: float = DEFAULT_SPEED


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "voices": available_voices,
        "default_voice": DEFAULT_VOICE,
    }


@app.get("/voices")
async def list_voices():
    return {"voices": available_voices}


def generate_audio_chunks(text: str, voice: str, speed: float):
    """Generator that yields WAV audio chunks."""
    if pipeline is None:
        raise RuntimeError("Pipeline not loaded")

    # kokoro-onnx API: returns (audio, sample_rate)
    audio, sr = pipeline.create(text, voice=voice, speed=speed)
    buf = io.BytesIO()
    sf.write(buf, audio, sr, format='WAV')
    buf.seek(0)
    while chunk := buf.read(CHUNK_SIZE):
        yield chunk


@app.post("/tts")
async def text_to_speech_post(request: TTSRequest):
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Pipeline not loaded")
    if request.voice not in available_voices:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown voice: {request.voice}. Available: {available_voices}"
        )
    return StreamingResponse(
        generate_audio_chunks(request.text, request.voice, request.speed),
        media_type="audio/wav",
        headers={
            "Content-Disposition": "attachment; filename=speech.wav",
            "Cache-Control": "no-cache",
        },
    )


@app.get("/tts")
async def text_to_speech_get(text: str, voice: str = DEFAULT_VOICE, speed: float = DEFAULT_SPEED):
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Pipeline not loaded")
    if len(text) > 1000:
        raise HTTPException(status_code=400, detail="Text too long (max 1000 characters)")
    if voice not in available_voices:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown voice: {voice}. Available: {available_voices}"
        )
    return StreamingResponse(
        generate_audio_chunks(text, voice, speed),
        media_type="audio/wav",
        headers={
            "Content-Disposition": "attachment; filename=speech.wav",
            "Cache-Control": "no-cache",
        },
    )


if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host=TTS_HOST,
        port=TTS_PORT,
        reload=False,
    )
