# Feature Spec — Memory · Transcribe · Research

## Memory (`lib/memory-core`, `bdm_memories`, RLS-enabled)
- Stores facts, preferences, reminders per user.
- Memory actions (`save`, `forget`) embedded in conversation turns.
- Retrieved via `retrieveRelevantMemories`; context injected into prompts.
- Privacy-first: private by default, no external exposure.

## Voice / Transcribe (`app/components/VoiceRecorder`, `lib/transcribe`)
- Voice notes recorded via browser microphone.
- Transcribed server-side; audio discarded after transcription (not stored).
- Transcribed text used as conversation input or saved to memory if asked.

## Research / Sourced Web (`lib/search.ts`, `searchSearxng`, `app/components/ResearchView`)
- Query submitted to SearXNG (`localhost:8080`) with `format=json`.
- Results filtered, cited, and shown with source URLs.
- Always shows sources behind claims; never synthesizes without attribution.

## Integration (Stage H)
- All three wired through `TaskDashboard`, `TaskRecovery`, `Sidebar`, `page.tsx`.
- Provider: `openrouter` (primary) with `ollama` fallback; `AI_PROVIDER=openrouter`.
- Image generation via `lib/images.ts` (`openrouter:image_generation`).
