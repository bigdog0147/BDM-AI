/**
 * Minimal ElevenLabs voice adapter
 * Reads ELEVENLABS_API_KEY from environment (set by CLI onboarding).
 * Does not expose keys in source.
 */

const API_KEY = process.env.ELEVENLABS_API_KEY || '';
const BASE_URL = 'https://api.elevenlabs.io/v1';

export interface VoiceInput {
  text?: string;
  audioBuffer?: Buffer;
}

export class VoiceAdapter {
  private key = API_KEY;

  isConfigured(): boolean {
    return !!this.key && this.key.length > 0;
  }

  async textToSpeech(text: string, voiceId = 'pNInz6obpgDQGcFmaJgB') {
    if (!this.isConfigured()) throw new Error('ELEVENLABS_API_KEY missing');
    const res = await fetch(`${BASE_URL}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, model_id: 'eleven_monolingual_v1', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
    });
    if (!res.ok) throw new Error(`TTS failed: ${res.status}`);
    return await res.arrayBuffer();
  }

  async speechToText(buffer: Buffer, mimeType = 'audio/mp3') {
    if (!this.isConfigured()) throw new Error('ELEVENLABS_API_KEY missing');
    const form = new FormData();
    const audioBytes = Uint8Array.from(buffer).buffer;
    form.append('file', new Blob([audioBytes]), 'recording.mp3');
    const res = await fetch(`${BASE_URL}/speech-to-text`, {
      method: 'POST',
      headers: { 'xi-api-key': this.key },
      body: form,
    });
    if (!res.ok) throw new Error(`STT failed: ${res.status}`);
    return await res.json();
  }
}
