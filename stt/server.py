"""STT Service — faster-whisper with FastAPI"""

import asyncio
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException
from faster_whisper import WhisperModel

load_dotenv()

STT_PORT = int(os.getenv("STT_PORT", "5002"))
STT_HOST = os.getenv("STT_HOST", "0.0.0.0")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "medium.en")

model: WhisperModel | None = None
gpu_semaphore = asyncio.Semaphore(1)  # One GPU operation at a time

ALLOWED_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".webm"}


def get_device_and_compute():
    """Auto-detect GPU and return (device, compute_type)."""
    try:
        import torch
        if torch.cuda.is_available():
            print(f"[STT] CUDA available: {torch.cuda.get_device_name(0)}")
            return "cuda", "float16"
    except ImportError:
        pass
    print("[STT] CUDA not available, using CPU")
    return "cpu", "int8"


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    device, compute_type = get_device_and_compute()
    print(f"[STT] Loading model: {WHISPER_MODEL} on {device} with {compute_type}")
    model = WhisperModel(WHISPER_MODEL, device=device, compute_type=compute_type)
    print(f"[STT] Model loaded successfully")
    yield
    del model
    model = None
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except ImportError:
        pass
    print("[STT] Model unloaded")


app = FastAPI(
    title="Kids Agent STT Service",
    description="Speech-to-text using faster-whisper",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    device, _ = get_device_and_compute()
    return {
        "status": "ok",
        "model": WHISPER_MODEL,
        "device": device,
    }


@app.post("/stt")
async def transcribe(file: UploadFile = File(...)):
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    ext = Path(file.filename or "audio.wav").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext}. Allowed: {ALLOWED_EXTENSIONS}"
        )
    
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        contents = await file.read()
        tmp.write(contents)
        tmp_path = tmp.name

    if os.path.getsize(tmp_path) > 25 * 1024 * 1024:  # 25MB limit
        os.unlink(tmp_path)
        raise HTTPException(status_code=413, detail="File too large (max 25MB)")

    try:
        async with gpu_semaphore:
            import asyncio as _asyncio
            loop = _asyncio.get_event_loop()
            segments, info = await loop.run_in_executor(
                None,
                lambda: model.transcribe(
                    tmp_path,
                    beam_size=5,
                    language="en",
                    vad_filter=True,
                    vad_parameters={"min_silence_duration_ms": 500},
                )
            )
        
        segment_list = list(segments)
        full_text = " ".join(segment.text.strip() for segment in segment_list)
        
        return {
            "text": full_text,
            "language": info.language,
            "language_probability": round(info.language_probability, 3),
            "duration": round(info.duration, 2),
            "segments": [
                {
                    "start": round(seg.start, 2),
                    "end": round(seg.end, 2),
                    "text": seg.text.strip(),
                }
                for seg in segment_list
            ],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription error: {str(e)}")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host=STT_HOST,
        port=STT_PORT,
        reload=False,
    )
