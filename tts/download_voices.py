#!/usr/bin/env python3
"""Download or set up reference voice audio files for TTS backends.

Some TTS backends (Chatterbox, Dia) require reference audio files for voice cloning.
This script checks the tts/voices/ directory and provides setup instructions.

You can also add your own .wav files (>=5s clean speech) to tts/voices/.
The filename (minus .wav) becomes the voice name.
"""
import os
import sys


def main():
    voices_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "voices")
    os.makedirs(voices_dir, exist_ok=True)

    print("Reference voice audio setup for TTS backends")
    print(f"Voice files directory: {voices_dir}")
    print()
    print("Some TTS backends (Chatterbox, Dia) require reference audio for voice cloning.")
    print("Add .wav files to tts/voices/ directory. Requirements:")
    print("  - .wav format")
    print("  - >= 5 seconds of clean single-speaker speech")
    print("  - No background music or noise")
    print("  - Filename (minus .wav) becomes the voice name")
    print()
    print("Example: tts/voices/female_warm.wav → voice name 'female_warm'")
    print()
    print("Kokoro and ChatTTS backends have built-in voices and don't need reference audio.")

    # Check for existing files
    wav_files = sorted([f for f in os.listdir(voices_dir) if f.endswith('.wav')])
    if wav_files:
        print(f"\n✓ Found {len(wav_files)} voice file(s): {', '.join(wav_files)}")
    else:
        print("\n⚠ No voice files found. Add .wav files to use Chatterbox or Dia backends.")
        print("  Tip: Record yourself reading a sentence for 10 seconds and save as default.wav")


if __name__ == "__main__":
    main()
