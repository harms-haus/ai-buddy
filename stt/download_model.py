"""Pre-download the Whisper model to avoid first-request delay."""
import os
from faster_whisper import WhisperModel

MODEL = os.getenv("WHISPER_MODEL", "medium.en")

print(f"Downloading model: {MODEL}...")
model = WhisperModel(MODEL, device="cpu", compute_type="int8")
print(f"Model {MODEL} downloaded and cached!")
