---
name: openai-whisper
description: Local speech-to-text with the Whisper CLI (no API key).
---

# Whisper Local Transcription

Transcribes audio files locally on the Mac mini using `whisper-cpp`.

## Usage

```bash
whisper-cpp -m /Users/javier/.openclaw/workspace/models/whisper/ggml-large-v3-turbo.bin -f <audio_file.wav>
```

### Note
- Input must be a **16kHz WAV** file.
- Use `ffmpeg` to convert other formats if needed.

## Example

```bash
ffmpeg -i inbound_voice.ogg -ar 16000 -ac 1 -c:a pcm_s16le output.wav
whisper-cpp -m /Users/javier/.openclaw/workspace/models/whisper/ggml-large-v3-turbo.bin -f output.wav
```
