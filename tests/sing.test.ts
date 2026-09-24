import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { extractJson, sanitizeReply, chat, llmConfigured, LlmUnavailable } from '../src/services/llm';
import {
  SING_MAX_QUEUE, generateSong, normalizeLyrics, parseQueryResult, queueLength, queuedSong, singCooldown, singHealthy, refundSingCooldown, SING_COOLDOWN_MS,
} from '../src/services/sing';

// A mock ACE-Step server that follows the documented contract.
let server: ReturnType<typeof Bun.serve>;
const seen: { submit?: any; polls: number; auth?: string | null } = { polls: 0 };
let failNext = false;
let hang = false;

beforeAll(() => {
  Bun.env.ACESTEP_URL = 'http://127.0.0.1:0';
  Bun.env.SING_POLL_MS = '10';
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      seen.auth = req.headers.get('authorization');
      if (u.pathname === '/health') return Response.json({ data: { status: 'ok', service: 'ACE-Step API' }, code: 200 });
      if (u.pathname === '/release_task') {
        seen.submit = await req.json();
        return Response.json({ data: { task_id: 'task-1', status: 'queued', queue_position: 1 }, code: 200 });
      }
      if (u.pathname === '/query_result') {
        seen.polls++;
        if (hang) return Response.json({ data: [{ task_id: 'task-1', status: 0 }], code: 200 });
        if (failNext) return Response.json({ data: [{ task_id: 'task-1', status: 2, result: '' }], code: 200 });
        if (seen.polls < 3) return Response.json({ data: [{ task_id: 'task-1', status: 0 }], code: 200 });
        return Response.json({ data: [{ task_id: 'task-1', status: 1, result: JSON.stringify([{ file: '/v1/audio?path=%2Ftmp%2Fx.mp3', status: 1, metas: { bpm: 120, keyscale: 'C Major', duration: 30 } }]) }], code: 200 });
      }
      if (u.pathname === '/v1/audio') return new Response(Buffer.from('ID3-fake-mp3-bytes'), { headers: { 'content-type': 'audio/mpeg' } });
      return new Response('nope', { status: 404 });
    },
  });
  Bun.env.ACESTEP_URL = `http://127.0.0.1:${server.port}`;
});
afterAll(() => { server.stop(true); delete Bun.env.ACESTEP_URL; delete Bun.env.SING_POLL_MS; });

describe('lyrics normalisation', () => {
  test('adds a [verse] tag to bare lyrics and keeps tagged lyrics', () => {
    expect(normalizeLyrics('la la la')).toBe('[verse]\nla la la');
    expect(normalizeLyrics('[chorus]\nhey')).toBe('[chorus]\nhey');
    expect(normalizeLyrics('a\n\n\n\nb')).toContain('a\n\nb');
    expect(normalizeLyrics('x'.repeat(5000)).length).toBeLessThanOrEqual(1800 + 8);
  });
  test('parseQueryResult handles array, object and garbage', () => {
    expect(parseQueryResult(JSON.stringify([{ file: '/a', metas: { bpm: 90, keyscale: 'D minor', duration: 12 } }]))).toEqual({ file: '/a', bpm: 90, key: 'D minor', duration: 12 });
    expect(parseQueryResult(JSON.stringify({ file: '/b' })).file).toBe('/b');
    expect(parseQueryResult('not json')).toEqual({});
    expect(parseQueryResult(undefined)).toEqual({});
  });
});

describe('ACE-Step client against the mock server', () => {
  test('health check', async () => { expect(await singHealthy()).toBe(true); });

  test('submits the documented payload, polls until done, downloads the file', async () => {
    seen.polls = 0;
    const stages: string[] = [];
    const r = await generateSong({ style: 'upbeat pop', lyrics: 'hello world', seconds: 999, language: 'es' }, s => stages.push(s));
    expect(r.mp3.toString()).toBe('ID3-fake-mp3-bytes');
    expect(r).toMatchObject({ bpm: 120, key: 'C Major' });
    expect(seen.submit).toMatchObject({ prompt: 'upbeat pop', lyrics: '[verse]\nhello world', audio_duration: 60, vocal_language: 'es', batch_size: 1, audio_format: 'mp3', task_type: 'text2music' });
    expect(seen.polls).toBe(3);
    expect(stages[0]).toContain('queued');
    expect(stages).toContain('composing');
  });

  test('clamps the length to the allowed range', async () => {
    seen.polls = 5;
    await generateSong({ style: 's', lyrics: 'l', seconds: 1 });
    expect(seen.submit.audio_duration).toBe(10);
  });

  test('sends the bearer token when configured', async () => {
    Bun.env.ACESTEP_API_KEY = 'secret';
    seen.polls = 5;
    await generateSong({ style: 's', lyrics: 'l', seconds: 20 });
    expect(seen.auth).toBe('Bearer secret');
    delete Bun.env.ACESTEP_API_KEY;
  });

  test('a failed task becomes a friendly error', async () => {
    failNext = true; seen.polls = 5;
    await expect(generateSong({ style: 's', lyrics: 'l', seconds: 20 })).rejects.toThrow(/failed to make that song/);
    failNext = false;
  });

  test('a stuck task times out instead of hanging forever', async () => {
    hang = true;
    Bun.env.SING_TIMEOUT_MS = '150';
    await expect(generateSong({ style: 's', lyrics: 'l', seconds: 20 })).rejects.toThrow(/too long/);
    hang = false;
    delete Bun.env.SING_TIMEOUT_MS;
  });

  test('an unreachable server gives the "studio offline" message', async () => {
    const saved = Bun.env.ACESTEP_URL;
    Bun.env.ACESTEP_URL = 'http://127.0.0.1:1';
    expect(await singHealthy()).toBe(false);
    await expect(generateSong({ style: 's', lyrics: 'l', seconds: 20 })).rejects.toThrow(/can't reach the music model/);
    Bun.env.ACESTEP_URL = saved;
  });
});

describe('queue and cooldown', () => {
  test('songs run one at a time and the queue is capped', async () => {
    const order: string[] = [];
    let running = 0, maxRunning = 0;
    const job = (name: string) => queuedSong(async () => { running++; maxRunning = Math.max(maxRunning, running); order.push(`start:${name}`); await Bun.sleep(30); running--; order.push(`end:${name}`); });
    const jobs = Array.from({ length: SING_MAX_QUEUE }, (_, i) => job(String(i)));
    expect(queueLength()).toBe(SING_MAX_QUEUE);
    await expect(job('overflow')).rejects.toThrow(/busy/);
    await Promise.all(jobs);
    expect(maxRunning).toBe(1);
    expect(order).toEqual(['start:0', 'end:0', 'start:1', 'end:1', 'start:2', 'end:2']);
    expect(queueLength()).toBe(0);
  });

  test('cooldown blocks repeat use and is refundable', () => {
    const now = 5_000_000;
    expect(singCooldown('s-user', now)).toBe(0);
    expect(singCooldown('s-user', now + 1000)).toBe(SING_COOLDOWN_MS - 1000);
    refundSingCooldown('s-user');
    expect(singCooldown('s-user', now + 2000)).toBe(0);
  });
});

describe('llm client', () => {
  const saved = { u: Bun.env.LLM_BASE_URL, m: Bun.env.LLM_MODEL, k: Bun.env.LLM_API_KEY };
  const restore = () => { for (const [k, v] of [['LLM_BASE_URL', saved.u], ['LLM_MODEL', saved.m], ['LLM_API_KEY', saved.k]] as const) { if (v === undefined) delete Bun.env[k]; else Bun.env[k] = v; } };

  test('unconfigured → LlmUnavailable', async () => {
    delete Bun.env.LLM_BASE_URL; delete Bun.env.LLM_MODEL;
    expect(llmConfigured()).toBe(false);
    await expect(chat([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(LlmUnavailable);
    restore();
  });

  test('posts an OpenAI-style request and returns the reply text', async () => {
    Bun.env.LLM_BASE_URL = 'http://llm.test/v1/'; Bun.env.LLM_MODEL = 'm1'; Bun.env.LLM_API_KEY = 'k1';
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => { captured = { url, init }; return Response.json({ choices: [{ message: { content: '  hello there  ' } }] }); }) as unknown as typeof fetch;
    const out = await chat([{ role: 'user', content: 'hi' }], { fetchImpl, json: true, maxTokens: 50 });
    expect(out).toBe('hello there');
    expect(captured!.url).toBe('http://llm.test/v1/chat/completions');
    expect((captured!.init.headers as Record<string, string>).Authorization).toBe('Bearer k1');
    expect(JSON.parse(captured!.init.body as string)).toMatchObject({ model: 'm1', max_tokens: 50, response_format: { type: 'json_object' } });
    restore();
  });

  test('retries once on 429, then surfaces API errors', async () => {
    Bun.env.LLM_BASE_URL = 'http://llm.test/v1'; Bun.env.LLM_MODEL = 'm1';
    let calls = 0;
    const flaky = (async () => (++calls === 1 ? new Response('slow down', { status: 429 }) : Response.json({ choices: [{ message: { content: 'ok' } }] }))) as unknown as typeof fetch;
    expect(await chat([{ role: 'user', content: 'x' }], { fetchImpl: flaky })).toBe('ok');
    expect(calls).toBe(2);
    const broken = (async () => Response.json({ error: { message: 'bad key' } }, { status: 401 })) as unknown as typeof fetch;
    await expect(chat([{ role: 'user', content: 'x' }], { fetchImpl: broken })).rejects.toThrow(/401.*bad key/);
    const empty = (async () => Response.json({ choices: [{ message: { content: '' } }] })) as unknown as typeof fetch;
    await expect(chat([{ role: 'user', content: 'x' }], { fetchImpl: empty })).rejects.toThrow(/empty/);
    restore();
  });

  test('extractJson pulls JSON out of chatty replies', () => {
    expect(extractJson<any>('Sure! ```json\n{"a":1,"b":[2,3]}\n``` hope that helps')).toEqual({ a: 1, b: [2, 3] });
    expect(extractJson<any>('Here: {"x": "y"} bye')).toEqual({ x: 'y' });
    expect(extractJson<any>('[1,2,3]')).toEqual([1, 2, 3]);
    expect(extractJson<any>('no json here')).toBeNull();
  });

  test('sanitizeReply defuses mass pings and truncates', () => {
    expect(sanitizeReply('hi @everyone and @here <@&123>')).not.toMatch(/@everyone|@here|<@&1/);
    expect(sanitizeReply('x'.repeat(5000)).length).toBeLessThanOrEqual(1900);
  });
});
