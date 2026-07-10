# ADR-005: Selection of OpenAI Realtime API for Low-Latency Voice AI

## Status
Accepted

## Context
Traditional voice AI systems suffer from high conversational latency: speech is transcribed to text (STT), text is fed to a large language model (LLM), and output text is synthesized to speech (TTS). This cascaded approach incurs 2-3 seconds of lag, making conversation awkward. CallAI requires sub-500ms conversation loops.

## Decision
We select **OpenAI Realtime API** (WebSockets) as the default voice engine, structured beneath an abstract `AiProvider` interface.

## Consequences
- **Ultra-low Latency**: Direct bidirectional audio streaming over WebSockets allows responses to start within 300-500ms of user speech completion.
- **Interruption Support**: The Realtime API natively handles interruptions by receiving buffer clearance commands (`input_audio_buffer.clear`) and cancellation triggers.
- **Provider Agnostic Design**: If OpenAI's model costs become prohibitive, or if we deploy custom-built low-latency models (e.g., self-hosted Whisper + VLLM + XTTS/F5-TTS), the `AiProvider` interface shields the rest of the application from change.
