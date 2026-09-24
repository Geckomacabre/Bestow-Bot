import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { ffmpeg, MediaError, probe, withWorkdir } from '../framework/media.js';

/**
 * Speech-to-text through any OpenAI-compatible /audio/transcriptions endpoint (OpenAI, Groq, a local faster-whisper server…).
 * Env: WHISPER_BASE_URL (defaults to LLM_BASE_URL), WHISPER_API_KEY (defaults to LLM_API_KEY), WHISPER_MODEL (default whisper-1).
 */

export const MAX_SECONDS = 600;

export interface WhisperConfig { baseUrl: string; apiKey: string; model: string }
export function whisperConfig(): WhisperConfig | null {
  const baseUrl = Bun.env.WHISPER_BASE_URL ?? Bun.env.LLM_BASE_URL;
  if (!baseUrl) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey: Bun.env.WHISPER_API_KEY ?? Bun.env.LLM_API_KEY ?? '', model: Bun.env.WHISPER_MODEL ?? 'whisper-1' };
}

/** Any audio/video → mono 16 kHz 32 kbps MP3 (a 10-minute clip is < 3 MB, well under provider upload limits). */
export async function toSpeechMp3(input: Buffer, name = 'input'): Promise<Buffer> {
  return withWorkdir(async dir => {
    const ext = path.extname(name).replace(/[^.\w]/g, '').slice(0, 8) || '.bin';
    const src = path.join(dir, `in${ext}`);
    await writeFile(src, input);
    const info = await probe(src, dir);
    if (!info.hasAudio) throw new MediaError('That file has no audio track.');
    if (info.duration && info.duration > MAX_SECONDS) throw new MediaError(`That's ${Math.round(info.duration / 60)} minutes long — the limit is ${MAX_SECONDS / 60} minutes.`);
    await ffmpeg(['-y', '-i', src, '-vn', '-t', String(MAX_SECONDS), '-ac', '1', '-ar', '16000', '-b:a', '32k', path.join(dir, 'out.mp3')], { cwd: dir, timeoutMs: 120_000 });
    return readFile(path.join(dir, 'out.mp3'));
  });
}

export async function transcribe(input: Buffer, name: string, opts: { fetchImpl?: typeof fetch; language?: string } = {}): Promise<{ text: string; seconds?: number }> {
  const cfg = whisperConfig();
  if (!cfg) throw new MediaError('Speech-to-text isn\'t configured on this bot (set WHISPER_BASE_URL or LLM_BASE_URL).');
  const mp3 = await toSpeechMp3(input, name);
  const form = new FormData();
  form.set('model', cfg.model);
  form.set('response_format', 'verbose_json');
  if (opts.language) form.set('language', opts.language);
  form.set('file', new File([new Uint8Array(mp3)], 'audio.mp3', { type: 'audio/mpeg' }));
  const res = await (opts.fetchImpl ?? fetch)(`${cfg.baseUrl}/audio/transcriptions`, {
    method: 'POST', body: form, headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}, signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const detail = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message;
    throw new MediaError(`The speech-to-text service returned an error (${res.status})${detail ? `: ${detail.slice(0, 120)}` : ''}.`);
  }
  const j = (await res.json()) as { text?: string; duration?: number };
  const text = j.text?.trim();
  if (!text) throw new MediaError('I couldn\'t hear any speech in that.');
  return { text, seconds: j.duration };
}
