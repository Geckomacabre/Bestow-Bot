import { HttpError } from '../framework/http.js';
import { LlmUnavailable, type ChatMessage } from '../services/llm.js';

/** /ai perplexity (Perplexity's Sonar web search) and /ai tts openai (OpenAI's speech voices). */

type Fetch = typeof fetch;

// ─── Perplexity Sonar ────────────────────────────────────────────────────────

export interface SonarAnswer { text: string; sources: { title: string; url: string }[] }

/** Sonar's reply: the answer plus its sources (`search_results`, or the older bare `citations` list). */
export function parseSonar(body: unknown): SonarAnswer {
  const b = body as { choices?: { message?: { content?: string } }[]; search_results?: { title?: string; url?: string }[]; citations?: string[] };
  const text = b.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Perplexity returned an empty answer.');
  const sources = b.search_results?.length
    ? b.search_results.filter(s => s.url).map(s => ({ title: s.title || new URL(s.url!).hostname, url: s.url! }))
    : (b.citations ?? []).map(url => ({ title: (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } })(), url }));
  return { text, sources: sources.slice(0, 8) };
}

export async function sonar(query: string, imageDataUri: string | null, fetchImpl: Fetch = fetch): Promise<SonarAnswer> {
  const key = Bun.env.PERPLEXITY_API_KEY;
  if (!key) throw new LlmUnavailable('Perplexity isn\'t set up on this bot yet (it needs PERPLEXITY_API_KEY).');
  const content: ChatMessage['content'] = imageDataUri ? [{ type: 'text', text: query }, { type: 'image_url', image_url: { url: imageDataUri } }] : query;
  const res = await fetchImpl('https://api.perplexity.ai/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(90_000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: Bun.env.PERPLEXITY_MODEL || 'sonar', messages: [{ role: 'system', content: 'Be precise and concise. Answer in under 250 words.' }, { role: 'user', content }] }),
  });
  if (!res.ok) throw new HttpError(res.status, 'api.perplexity.ai', `Perplexity error ${res.status}`);
  return parseSonar(await res.json());
}

// ─── OpenAI text-to-speech ───────────────────────────────────────────────────

export const OPENAI_VOICES = ['Alloy', 'Echo', 'Fable', 'Onyx', 'Nova', 'Shimmer'] as const;

/** MP3 of `text` in one of OpenAI's voices (OPENAI_API_KEY; OPENAI_TTS_BASE_URL for a compatible server). */
export async function openaiSpeech(text: string, voice: string, fetchImpl: Fetch = fetch): Promise<Buffer> {
  const key = Bun.env.OPENAI_API_KEY;
  const base = (Bun.env.OPENAI_TTS_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  if (!key && !Bun.env.OPENAI_TTS_BASE_URL) throw new LlmUnavailable('OpenAI voices aren\'t set up on this bot yet (it needs OPENAI_API_KEY).');
  const res = await fetchImpl(`${base}/audio/speech`, {
    method: 'POST', signal: AbortSignal.timeout(60_000),
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model: Bun.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts', voice: voice.toLowerCase(), input: text, response_format: 'mp3' }),
  });
  if (!res.ok) throw new HttpError(res.status, base, `OpenAI speech error ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
