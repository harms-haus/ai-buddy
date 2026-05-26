# TTS Service — Multi-Backend (Wyoming Protocol)

Text-to-speech service with four backend engines, exposed via [Wyoming protocol](https://github.com/OHF-Voice/wyoming) for Home Assistant integration. Supports streaming synthesis, emotion/prosody control, and voice cloning.

## Backends

| Backend | `TTS_BACKEND` | License | GPU Required | Voice Cloning | Emotion Control | Model Size |
|---------|--------------|---------|-------------|---------------|----------------|------------|
| **Kokoro** | `kokoro` | Apache 2.0 | No (CPU OK) | No (54 built-in) | No | ~90 MB |
| **Chatterbox** | `chatterbox` | MIT | No (recommended) | Yes (`.wav` ref) | Yes (`exaggeration` + tags) | ~1.5 GB |
| **Dia** | `dia` | Apache 2.0 | Recommended (CPU fallback, very slow) | No (default/random) | Yes (20+ tags) | ~1.6 GB |
| **ChatTTS** | `chattts` | AGPLv3 / CC-BY-NC | No (GPU recommended) | No (random speaker) | Yes (prosody tokens) | ~800 MB |

> **Default**: Kokoro is installed by default and requires no GPU. It's the recommended choice for most setups.

## Setup

### 1. Core dependencies (required for all backends)

```bash
cd tts
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

This installs the Wyoming server, numpy, zeroconf, and the **Kokoro** backend (`kokoro-onnx`). No additional steps needed for Kokoro — model files download automatically on first run.

### 2. Backend-specific dependencies

Only install what you need for your chosen backend:

```bash
# Chatterbox
pip install chatterbox-tts

# Dia
pip install git+https://github.com/nari-labs/dia.git

# ChatTTS (⚠️ non-commercial license only)
pip install ChatTTS
```

### 3. Voice reference files (Chatterbox only)

Chatterbox uses `.wav` reference audio for voice cloning. Add files to `tts/voices/`:

```bash
# Quick setup with sample voices
python download_voices.py
```

See [voices/README.md](voices/README.md) for requirements and details.

## Configuration

Copy and edit the environment file:

```bash
cp .env.example .env
```

### Server settings

| Variable | Default | Description |
|----------|---------|-------------|
| `TTS_BACKEND` | `kokoro` | Backend engine: `kokoro`, `chatterbox`, `dia`, or `chattts` |
| `TTS_PORT` | `10201` | Wyoming TCP port |
| `TTS_HOST` | `127.0.0.1` | Listen address |
| `TTS_VOICE` | *(per-backend)* | Default voice name (overrides backend-specific `*_VOICE` vars) |
| `TTS_SPEED` | `1.0` | Default speech speed (overrides backend-specific `*_SPEED` vars) |

### Kokoro

| Variable | Default | Description |
|----------|---------|-------------|
| `KOKORO_VOICE` | `af_heart` | Default voice (54 available) |
| `KOKORO_SPEED` | `1.0` | Speech speed (0.5–2.0) |
| `KOKORO_MODEL_PATH` | `kokoro-v1.0.onnx` | Path to ONNX model file |
| `KOKORO_VOICES_PATH` | `voices-v1.0.bin` | Path to voices binary file |

Model files are downloaded automatically from [kokoro-onnx releases](https://github.com/thewh1teagle/kokoro-onnx/releases) on first run.

### Chatterbox

| Variable | Default | Description |
|----------|---------|-------------|
| `CHATTERBOX_DEVICE` | *(auto-detect)* | `cuda` or `cpu` — auto-detects GPU if unset |
| `CHATTERBOX_EXAGGERATION` | `0.5` | Emotion intensity (0.25–2.0+, higher = more expressive) |
| `CHATTERBOX_CFG_WEIGHT` | `0.0` | Classifier-free guidance weight |
| `CHATTERBOX_TEMPERATURE` | `0.8` | Sampling temperature |

### Dia

| Variable | Default | Description |
|----------|---------|-------------|
| `DIA_DEVICE` | `cuda` | Device — CUDA strongly recommended |
| `DIA_MODEL` | `nari-labs/Dia-1.6B-0626` | Model identifier |

### ChatTTS

| Variable | Default | Description |
|----------|---------|-------------|
| `CHATTTS_TEMPERATURE` | `0.3` | Sampling temperature |
| `CHATTTS_REFINE_PROMPT` | `[oral_2][laugh_0][break_4]` | Prosody refinement tokens applied to all text |

> ⚠️ **License warning**: ChatTTS is AGPLv3+ (code) + CC-BY-NC 4.0 (model). **Non-commercial use only.**

## Voices

### Kokoro — 54 built-in voices

No voice files needed. Notable English voices:
- Female: `af_heart`, `af_sky`, `af_sarah`, `af_nicole`, `af_bella`
- Male: `am_michael`, `am_adam`

Full list is available via the Wyoming `Describe` response.

### Chatterbox — voice cloning from reference audio

Chatterbox scans `tts/voices/` for `.wav` files. The filename (minus extension) becomes the voice name:

| File | Voice name |
|------|-----------|
| `tts/voices/female_warm.wav` | `female_warm` |
| `tts/voices/male_calm.wav` | `male_calm` |

**Requirements** for reference audio:
- `.wav` format
- ≥5 seconds of clean, single-speaker speech
- No background music or noise

If no reference files are found, Chatterbox falls back to a built-in default.

### Dia — default/random voice

Dia does **not** support voice cloning from reference audio files. Although voice files in `tts/voices/` are scanned and listed as available voices, they are not passed to the model during synthesis — voice selection has no effect. Dia uses a default/random voice. Emotion tags like `(laughs)`, `(sighs)`, etc. are the primary control mechanism for shaping output.

### ChatTTS — random speaker embedding

ChatTTS generates a random speaker embedding on startup. The only voice name is `random`.

## Emotion & Prosody Tags

Each backend supports embedding emotion cues directly in the synthesis text:

### Chatterbox — inline emotion tags + exaggeration

Insert bracketed tags anywhere in the text:

```
[laugh] [chuckle] [sigh] [gasp] [cough] [groan] [sniff] [shush] [clear throat]
```

The `CHATTERBOX_EXAGGERATION` setting (0.25–2.0+) controls overall expressiveness globally:

```bash
# Subtle, calm speech
CHATTERBOX_EXAGGERATION=0.25

# Dramatic, animated speech
CHATTERBOX_EXAGGERATION=1.5
```

### Dia — parenthesized emotion tags

Dia supports 20+ emotion tags wrapped in parentheses:

```
(laughs) (sighs) (gasps) (singing) (mumbles) (screams) (chuckle) (whistles) ...
```

### ChatTTS — prosody control tokens

ChatTTS uses a text refinement pipeline controlled by `CHATTTS_REFINE_PROMPT`:

```
[laugh] [uv_break] [lbreak] [oral_0-9] [laugh_0-2] [break_0-7]
```

Example configurations:

```bash
# Natural conversational tone with pauses
CHATTTS_REFINE_PROMPT=[oral_2][laugh_0][break_4]

# More animated with laughs
CHATTTS_REFINE_PROMPT=[oral_5][laugh_2][break_2]
```

## Running

### Direct

```bash
cd tts
source venv/bin/activate
python server.py
```

The server reads `.env` automatically. Set `TTS_BACKEND` to choose the engine:

```bash
TTS_BACKEND=chatterbox python server.py
```

### Via dev.sh

```bash
./dev.sh                      # Kokoro (default)
./dev.sh --tts=chatterbox     # Chatterbox backend
./dev.sh --tts=dia            # Dia backend
./dev.sh --tts=chattts        # ChatTTS backend
```

### Home Assistant integration

The server registers via Zeroconf/mDNS as `kids-agent-tts-{backend}`. If Home Assistant doesn't auto-discover, manually add a **Wyoming** integration pointing to the server's host and port.

## Wyoming Protocol

Implements TTS via the Wyoming TCP protocol:

1. **`Describe`** → server returns `Info` event with TTS programs, available voices, and attribution
2. **`Synthesize`** → client sends text (+ optional voice), server responds with streaming audio:
   - `AudioStart` — audio format header (rate, width, channels)
   - `AudioChunk` — one or more PCM audio chunks (16-bit signed LE, mono)
   - `AudioStop` — end of audio

Audio is streamed in chunks of 8192 samples for low-latency playback. All backends output at **24000 Hz, 16-bit, mono** PCM (Dia internally resamples from 44100 Hz).

The server disconnects after each synthesis completes. Text is limited to **5000 characters** — longer text receives an `InputTooLong` error event.

GPU-based backends (Chatterbox, Dia, ChatTTS) serialize concurrent requests with a semaphore to prevent GPU OOM.

## Testing

Run from the project root (not the `tts/` directory):

```bash
python tests/test_tts.py
```

Set `TTS_BACKEND` before running to test a specific engine:

```bash
TTS_BACKEND=chatterbox python tests/test_tts.py
```
