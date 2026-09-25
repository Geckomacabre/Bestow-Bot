import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { initDb } from '../src/utils/db';
import {
  ElevenUnavailable, dailyCharCap, elevenConfigured, elevenCredit, freeCharsPerDay, listElevenVoices, refundChars, reserveChars, resetElevenBudgets, resetElevenCache, synthEleven,
} from '../src/services/elevenlabs';
import { ALL_VOICES, ensureElevenVoices, findVoice, searchVoices, setElevenVoices, speak, speakableLength, voiceIcon } from '../src/services/tts';
import { resetPremiumCache } from '../src/premium';

beforeAll(async () => { await initDb(); });

const realFetch = globalThis.fetch;
const FAKE_KEY = 'sk_' + 'x'.repeat(40); // obviously fake; assembled here so no key-shaped literal sits in the file
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ['ELEVENLABS_API_KEY', 'ELEVENLABS_MODEL', 'ELEVENLABS_FREE_CHARS_PER_DAY', 'ELEVENLABS_DAILY_CHARS', 'OWNER_IDS', 'PREMIUM_SKU_ID']) delete Bun.env[k];
  resetElevenCache(); resetElevenBudgets(); setElevenVoices([]); resetPremiumCache();
});

const VOICES = [
  { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah - Mature, Reassuring', labels: { gender: 'female', accent: 'american', description: 'confident' } },
  { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'Wendell', labels: { gender: 'male', accent: 'british', use_case: 'narration' } },
];

interface Call { url: string; method: string; headers: Record<string, string>; body: any }
function mock(o: { voices?: unknown[]; count?: number; limit?: number; status?: number; detail?: unknown; ttsStatus?: number; audio?: Buffer } = {}) {
  const calls: Call[] = [];
  const impl = async (url: unknown, init: RequestInit = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method ?? 'GET', headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : null });
    const err = (status: number) => new Response(JSON.stringify({ detail: o.detail ?? {} }), { status, headers: { 'content-type': 'application/json' } });
    if (o.status && o.status >= 400) return err(o.status);
    if (u.includes('/v1/voices')) return Response.json({ voices: o.voices ?? VOICES });
    if (u.includes('/v1/user/subscription')) return Response.json({ character_count: o.count ?? 0, character_limit: o.limit ?? 100_000 });
    if (u.includes('/v1/text-to-speech/')) return o.ttsStatus ? err(o.ttsStatus) : new Response(new Uint8Array(o.audio ?? Buffer.alloc(600, 7)), { headers: { 'content-type': 'audio/mpeg' } });
    return new Response('not found', { status: 404 });
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

describe('configuration', () => {
  test('is off without a key, and the defaults are cost-conscious', () => {
    expect(elevenConfigured()).toBe(false);
    Bun.env.ELEVENLABS_API_KEY = FAKE_KEY; expect(elevenConfigured()).toBe(true);
    expect(freeCharsPerDay()).toBe(1000); expect(dailyCharCap()).toBe(20_000);
    Bun.env.ELEVENLABS_FREE_CHARS_PER_DAY = '250'; Bun.env.ELEVENLABS_DAILY_CHARS = '5000'; expect(freeCharsPerDay()).toBe(250); expect(dailyCharCap()).toBe(5000);
    Bun.env.ELEVENLABS_FREE_CHARS_PER_DAY = 'lots'; expect(freeCharsPerDay()).toBe(1000);
  });
});

describe('voices', () => {
  test('are read from the account, tidied, cached, and sent with the key', async () => {
    Bun.env.ELEVENLABS_API_KEY = FAKE_KEY;
    const m = mock();
    const v = await listElevenVoices({ fetchImpl: m.impl });
    expect(v).toEqual([
      { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', gender: 'Female', lang: 'en-US', blurb: 'ElevenLabs · American · Female · confident' },
      { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'Wendell', gender: 'Male', lang: 'en-GB', blurb: 'ElevenLabs · British · Male · narration' },
    ]);
    expect(m.calls[0]!.headers['xi-api-key']).toBe(FAKE_KEY);
    await listElevenVoices({ fetchImpl: m.impl }); expect(m.calls).toHaveLength(1); // cached
  });
  test('only the first 40 are kept', async () => {
    Bun.env.ELEVENLABS_API_KEY = FAKE_KEY;
    const many = Array.from({ length: 90 }, (_, n) => ({ voice_id: `voice${String(n).padStart(6, '0')}`, name: `V${n}`, labels: {} }));
    expect(await listElevenVoices({ fetchImpl: mock({ voices: many }).impl })).toHaveLength(40);
  });
  test('show up in the /tts voice list once loaded, and disappear without a key', async () => {
    Bun.env.ELEVENLABS_API_KEY = FAKE_KEY;
    await ensureElevenVoices(mock().impl);
    const sarah = findVoice('eleven:EXAVITQu4vr4xnSDxMaL')!;
    expect(sarah).toMatchObject({ label: 'Sarah', engine: 'eleven' }); expect(voiceIcon(sarah)).toBe('✨');
    expect(findVoice('Wendell')?.engine).toBe('eleven');
    expect(findVoice('Sarah')?.engine).toBe('kokoro'); // a typed name that a free voice shares resolves to the free one — never silently billed
    expect(searchVoices('').some(x => x.engine === 'eleven')).toBe(true);
    expect(searchVoices('elevenlabs').every(x => x.engine === 'eleven')).toBe(true); expect(searchVoices('british').some(x => x.label === 'Wendell')).toBe(true);
    for (const x of ALL_VOICES) expect(x.lang).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    delete Bun.env.ELEVENLABS_API_KEY; await ensureElevenVoices(); expect(ALL_VOICES.some(x => x.engine === 'eleven')).toBe(false);
  });
  test('a failed lookup leaves the list alone instead of breaking /tts', async () => {
    Bun.env.ELEVENLABS_API_KEY = FAKE_KEY;
    const orig = console.error; console.error = () => {};
    try { await ensureElevenVoices(mock({ status: 401, detail: { status: 'invalid_api_key' } }).impl); } finally { console.error = orig; }
    expect(ALL_VOICES.some(x => x.engine === 'eleven')).toBe(false);
  });
});

describe('speech requests', () => {
  test('post the text with the right model, format and a clamped speed', async () => {
    Bun.env.ELEVENLABS_API_KEY = FAKE_KEY;
    const m = mock();
    const mp3 = await synthEleven('Hello there', 'EXAVITQu4vr4xnSDxMaL', { fetchImpl: m.impl, speed: 5 });
    expect(mp3.length).toBe(600);
    const tts = m.calls.find(c => c.url.includes('/text-to-speech/'))!;
    expect(tts.method).toBe('POST'); expect(tts.url).toContain('/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL?output_format=mp3_'); expect(tts.headers['xi-api-key']).toBe(FAKE_KEY);
    expect(tts.body).toEqual({ text: 'Hello there', model_id: 'eleven_flash_v2_5', voice_settings: { speed: 1.2 } });
    Bun.env.ELEVENLABS_MODEL = 'eleven_multilingual_v2';
    const m2 = mock(); await synthEleven('x'.repeat(5), 'EXAVITQu4vr4xnSDxMaL', { fetchImpl: m2.impl, speed: 0.1 });
    expect(m2.calls.find(c => c.url.includes('/text-to-speech/'))!.body).toMatchObject({ model_id: 'eleven_multilingual_v2', voice_settings: { speed: 0.7 } });
  });
  test('are refused up front when the account has less credit than the text needs — no request is made', async () => {
    Bun.env.ELEVENLABS_API_KEY = FAKE_KEY;
    const m = mock({ count: 990, limit: 1000 });
    await expect(synthEleven('y'.repeat(50), 'EXAVITQu4vr4xnSDxMaL', { fetchImpl: m.impl })).rejects.toMatchObject({ kind: 'credit' });
    expect(m.calls.some(c => c.url.includes('/text-to-speech/'))).toBe(false);
    const c = await elevenCredit({ fetchImpl: m.impl }); expect(c).toEqual({ used: 990, limit: 1000, remaining: 10 });
  });
  test('reject a malformed voice id without calling out (it goes into a URL)', async () => {
    Bun.env.ELEVENLABS_API_KEY = FAKE_KEY;
    const m = mock();
    for (const bad of ['../../v1/user', 'a b', 'short', 'x'.repeat(41), '']) await expect(synthEleven('hi', bad, { fetchImpl: m.impl })).rejects.toBeInstanceOf(ElevenUnavailable);
    expect(m.calls).toHaveLength(0);
  });
  test('turn each failure into a message that is safe to show', async () => {
    Bun.env.ELEVENLABS_API_KEY = FAKE_KEY;
    const cases: [number, unknown, string, string][] = [
      [401, { status: 'invalid_api_key' }, 'key', 'rejected'], [401, 'nope', 'key', 'rejected'], [400, { status: 'quota_exceeded' }, 'credit', 'out of credit'],
      [402, {}, 'plan', 'plan'], [403, {}, 'plan', 'plan'], [429, {}, 'busy', 'busy'], [500, {}, 'other', '500'],
    ];
    for (const [status, detail, kind, text] of cases) {
      resetElevenCache();
      const e = await synthEleven('hello', 'EXAVITQu4vr4xnSDxMaL', { fetchImpl: mock({ ttsStatus: status, detail }).impl }).catch(x => x);
      expect(e, `${status}`).toBeInstanceOf(ElevenUnavailable); expect(e.kind, `${status}`).toBe(kind); expect(e.message).toContain(text);
      expect(e.message).not.toContain(FAKE_KEY);
    }
    const down = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    resetElevenCache();
    expect(await synthEleven('hello', 'EXAVITQu4vr4xnSDxMaL', { fetchImpl: down }).catch(x => x)).toMatchObject({ kind: 'busy' });
  });
  test('cannot run at all without a key', async () => {
    expect(await synthEleven('hi', 'EXAVITQu4vr4xnSDxMaL', { fetchImpl: mock().impl }).catch(x => x)).toMatchObject({ kind: 'key' });
  });
});

describe('character budgets', () => {
  test('a free person gets a daily allowance; Premium is only held to the bot-wide cap', () => {
    const t = Date.UTC(2026, 0, 5, 12);
    expect(reserveChars('u1', 600, false, t)).toEqual({ ok: true });
    expect(reserveChars('u1', 600, false, t)).toEqual({ ok: false, reason: 'user', left: 400 });
    expect(reserveChars('u1', 400, false, t)).toEqual({ ok: true });
    expect(reserveChars('u1', 1, false, t)).toMatchObject({ ok: false, reason: 'user', left: 0 });
    expect(reserveChars('u1', 5000, true, t)).toEqual({ ok: true }); // premium: no per-person limit
    expect(reserveChars('u2', 100, false, t)).toEqual({ ok: true }); // everyone has their own allowance
  });
  test('resets each day, and refunds hand characters back', () => {
    const d1 = Date.UTC(2026, 0, 5, 23, 59), d2 = Date.UTC(2026, 0, 6, 0, 1);
    expect(reserveChars('u3', 1000, false, d1)).toEqual({ ok: true }); expect(reserveChars('u3', 1, false, d1)).toMatchObject({ ok: false });
    expect(reserveChars('u3', 1000, false, d2)).toEqual({ ok: true });
    refundChars('u3', 1000, d2); expect(reserveChars('u3', 1000, false, d2)).toEqual({ ok: true });
  });
  test('the whole bot has a daily cap that even Premium cannot pass', () => {
    Bun.env.ELEVENLABS_DAILY_CHARS = '1500';
    const t = Date.UTC(2026, 0, 7, 8);
    expect(reserveChars('a', 1000, true, t)).toEqual({ ok: true });
    expect(reserveChars('b', 600, true, t)).toEqual({ ok: false, reason: 'global', left: 500 });
    expect(reserveChars('b', 500, true, t)).toEqual({ ok: true });
    expect(reserveChars('c', 1, true, t)).toMatchObject({ ok: false, reason: 'global' });
  });
});

describe('speak() with an ElevenLabs voice', () => {
  const free = async () => Buffer.from('FREE-AUDIO'.repeat(30));
  test('uses ElevenLabs when it works', async () => {
    Bun.env.ELEVENLABS_API_KEY = FAKE_KEY; await ensureElevenVoices(mock().impl);
    const r = await speak('Good morning', 'eleven:EXAVITQu4vr4xnSDxMaL', 1, { fetchImpl: mock().impl, freeSynth: free });
    expect(r.voice.engine).toBe('eleven'); expect(r.note).toBeUndefined(); expect(r.mp3.length).toBe(600);
  });
  test('falls back to a free voice of the same gender, and says why, when ElevenLabs refuses', async () => {
    Bun.env.ELEVENLABS_API_KEY = FAKE_KEY; await ensureElevenVoices(mock().impl);
    const orig = console.error; console.error = () => {};
    try {
      const r = await speak('Good morning', 'eleven:JBFqnCBsd6RMkjVDRZzb', 1, { fetchImpl: mock({ ttsStatus: 401, detail: { status: 'invalid_api_key' } }).impl, freeSynth: free });
      expect(r.voice).toMatchObject({ engine: 'kokoro', gender: 'Male' }); expect(r.note).toContain('free voice'); expect(r.mp3.toString()).toContain('FREE-AUDIO');
      const q = await speak('Good morning', 'eleven:EXAVITQu4vr4xnSDxMaL', 1, { fetchImpl: mock({ ttsStatus: 400, detail: { status: 'quota_exceeded' } }).impl, freeSynth: free });
      expect(q.voice).toMatchObject({ engine: 'kokoro', gender: 'Female' }); expect(q.note).toContain('out of credit');
    } finally { console.error = orig; }
  });
  test('billable length counts only what would be spoken', () => {
    expect(speakableLength('Hello **world** <@123> https://example.com/x 😀')).toBe('Hello world someone link'.length);
    expect(speakableLength('a'.repeat(900))).toBe(500);
  });
});

