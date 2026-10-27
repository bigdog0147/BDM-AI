/**
 * Voice note upload route — stores recording metadata, transcribes via ElevenLabs adapter.
 */
import { NextRequest, NextResponse } from 'next/server';
import { VoiceAdapter } from '@/lib/voice/adapter';

export const runtime = 'edge';

const adapter = new VoiceAdapter();

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'File required' }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'Max 10 MB' }, { status: 413 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const transcription = await adapter.speechToText(buffer, file.type || 'audio/mpeg');

    return NextResponse.json({ ok: true, transcription });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
