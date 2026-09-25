/**
 * ElevenLabs text-to-speech. Optional: nothing here runs unless ELEVENLABS_API_KEY is set.
 *
 * ElevenLabs bills per character, so three things protect the account:
 *  - each person gets a small daily character budget (ELEVENLABS_FREE_CHARS_PER_DAY, default 1000); Premium is unlimited,
 *  - the whole bot has a daily cap (ELEVENLABS_DAILY_CHARS, default 20000),
 *  - the account's real remaining credit is checked before every request.
 * Budgets live in memory only (they reset on restart), so nothing about a person is stored.
 *
 * Env: ELEVENLABS_API_KEY (the secret that starts with "sk_" — not the key's ID), ELEVENLABS_MODEL (default eleven_flash_v2_5, the cheapest).
 */

const BASE = 'https://api.elevenlabs.io';

export const elevenKey = (): string | null => Bun.env.ELEVENLABS_API_KEY?.trim() || null;
export const elevenConfigured = (): boolean => !!elevenKey();
export const elevenModel = (): string => Bun.env.ELEVENLABS_MODEL?.trim() || 'eleven_flash_v2_5';

const envInt = (name: string, fallback: number): number => { const n = Number(Bun.env[name]); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback; };
export const freeCharsPerDay = (): number => envInt('ELEVENLABS_FREE_CHARS_PER_DAY', 1000);
export const dailyCharCap = (): number => envInt('ELEVENLABS_DAILY_CHARS', 20_000);

/** ElevenLabs is unavailable or refused (bad key, out of credit, busy…). The message is safe to show. */
export class ElevenUnavailable extends Error {
  constructor(message: string, public kind: 'key' | 'credit' | 'plan' | 'busy' | 'other' = 'other') { super(message); this.name = 'ElevenUnavailable'; }
}

interface Deps { fetchImpl?: typeof fetch }

async function api(path: string, init: RequestInit, d: Deps = {}): Promise<Response> {
  const key = elevenKey();
  if (!key) throw new ElevenUnavailable('ElevenLabs isn\'t configured on this bot.', 'key');
  let res: Response;
  try {
    res = await (d.fetchImpl ?? fetch)(`${BASE}${path}`, { ...init, headers: { 'xi-api-key': key, ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new ElevenUnavailable(/timed out|abort/i.test((err as Error).message) ? 'ElevenLabs took too long to answer.' : 'I couldn\'t reach ElevenLabs.', 'busy');
  }
  if (res.ok) return res;
  const body = (await res.json().catch(() => null)) as { detail?: { status?: string; message?: string } | string } | null;
  const status = typeof body?.detail === 'object' ? body.detail?.status : undefined;
  if (res.status === 401 || status === 'invalid_api_key') throw new ElevenUnavailable('The ElevenLabs key was rejected.', 'key');
  if (status === 'quota_exceeded') throw new ElevenUnavailable('ElevenLabs is out of credit for now.', 'credit');
  if (res.status === 402 || res.status === 403) throw new ElevenUnavailable('That voice isn\'t available on this ElevenLabs plan.', 'plan');
  if (res.status === 429) throw new ElevenUnavailable('ElevenLabs is busy — try again in a moment.', 'busy');
  throw new ElevenUnavailable(`ElevenLabs returned an error (${res.status}).`);
}

// ─── Voices ──────────────────────────────────────────────────────────────────

export interface ElevenVoice { id: string; name: string; gender: 'Female' | 'Male'; lang: string; blurb: string }

const MAX_VOICES = 40;
const ACCENT_LANG: Record<string, string> = { american: 'en-US', british: 'en-GB', australian: 'en-AU', indian: 'en-IN', irish: 'en-GB', canadian: 'en-US' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

let voiceCache: { at: number; voices: ElevenVoice[] } | null = null;
export const resetElevenCache = () => { voiceCache = null; creditCache = null; };

/** The voices on the account (premade and any you've added), cached for an hour. */
export async function listElevenVoices(d: Deps = {}, now = Date.now()): Promise<ElevenVoice[]> {
  if (voiceCache && now - voiceCache.at < 3_600_000) return voiceCache.voices;
  const j = (await (await api('/v1/voices', { headers: { Accept: 'application/json' } }, d)).json()) as { voices?: { voice_id: string; name: string; labels?: Record<string, string> }[] };
  const voices = (j.voices ?? []).slice(0, MAX_VOICES).map((v): ElevenVoice => {
    const l = v.labels ?? {};
    const gender = l.gender?.toLowerCase() === 'male' ? 'Male' : 'Female';
    const traits = [l.accent && cap(l.accent), l.gender && cap(l.gender), l.description ?? l.use_case].filter(Boolean).join(' · ');
    return { id: v.voice_id, name: v.name.split(/\s[-–—]\s/)[0]!.slice(0, 40), gender, lang: ACCENT_LANG[l.accent?.toLowerCase() ?? ''] ?? 'en-US', blurb: `ElevenLabs${traits ? ` · ${traits}` : ''}`.slice(0, 80) };
  });
  voiceCache = { at: now, voices };
  return voices;
}

// ─── Credit ──────────────────────────────────────────────────────────────────

export interface Credit { used: number; limit: number; remaining: number }
let creditCache: { at: number; value: Credit } | null = null;

/** The account's live character credit (cached for a minute). */
export async function elevenCredit(d: Deps = {}, now = Date.now()): Promise<Credit> {
  if (creditCache && now - creditCache.at < 60_000) return creditCache.value;
  const j = (await (await api('/v1/user/subscription', { headers: { Accept: 'application/json' } }, d)).json()) as { character_count?: number; character_limit?: number };
  const used = j.character_count ?? 0, limit = j.character_limit ?? 0;
  const value = { used, limit, remaining: Math.max(0, limit - used) };
  creditCache = { at: now, value };
  return value;
}

// ─── Speech ──────────────────────────────────────────────────────────────────

/** Text → MP3. Refuses (rather than fail after the fact) when the account has less credit than the text needs. */
export async function synthEleven(text: string, voiceId: string, o: Deps & { speed?: number } = {}): Promise<Buffer> {
  if (!/^[A-Za-z0-9]{8,40}$/.test(voiceId)) throw new ElevenUnavailable('That isn\'t a valid ElevenLabs voice.', 'other');
  const credit = await elevenCredit(o).catch(() => null); // if the balance can't be read, let the request itself decide
  if (credit && credit.limit > 0 && credit.remaining < text.length) throw new ElevenUnavailable('ElevenLabs is out of credit for now.', 'credit');
  const speed = Math.min(1.2, Math.max(0.7, o.speed ?? 1));
  const res = await api(`/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: elevenModel(), voice_settings: { speed } }),
  }, o);
  const mp3 = Buffer.from(await res.arrayBuffer());
  if (mp3.length < 200) throw new ElevenUnavailable('ElevenLabs returned no audio.');
  if (creditCache) creditCache.value = { ...creditCache.value, used: creditCache.value.used + text.length, remaining: Math.max(0, creditCache.value.remaining - text.length) };
  return mp3;
}

// ─── Budgets ─────────────────────────────────────────────────────────────────

const day = (now: number) => new Date(now).toISOString().slice(0, 10);
const perUser = new Map<string, { day: string; chars: number }>();
let global = { day: '', chars: 0 };
export const resetElevenBudgets = () => { perUser.clear(); global = { day: '', chars: 0 }; };

export type Reserve = { ok: true } | { ok: false; reason: 'user' | 'global'; left: number };

/** Sets aside `chars` for a request, or says why not. Premium people aren't limited per person, only by the bot-wide cap. */
export function reserveChars(userId: string, chars: number, premium: boolean, now = Date.now()): Reserve {
  const d = day(now);
  if (global.day !== d) global = { day: d, chars: 0 };
  if (global.chars + chars > dailyCharCap()) return { ok: false, reason: 'global', left: Math.max(0, dailyCharCap() - global.chars) };
  let u = perUser.get(userId);
  if (!u || u.day !== d) { u = { day: d, chars: 0 }; perUser.set(userId, u); }
  if (!premium && u.chars + chars > freeCharsPerDay()) return { ok: false, reason: 'user', left: Math.max(0, freeCharsPerDay() - u.chars) };
  u.chars += chars; global.chars += chars;
  if (perUser.size > 5000) for (const [k, v] of perUser) if (v.day !== d) perUser.delete(k);
  return { ok: true };
}

/** Gives characters back (the request failed or fell back to a free voice). */
export function refundChars(userId: string, chars: number, now = Date.now()): void {
  const d = day(now), u = perUser.get(userId);
  if (u && u.day === d) u.chars = Math.max(0, u.chars - chars);
  if (global.day === d) global.chars = Math.max(0, global.chars - chars);
}
