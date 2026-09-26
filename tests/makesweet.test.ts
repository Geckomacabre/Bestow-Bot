import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { MediaError } from '../src/framework/media';
import { makeJob, type Job } from '../src/media/effects';
import { API, SLUGS, TEMPLATES, explain, hooks, makesweet } from '../src/media/makesweet';

const haveFfmpeg = !!Bun.which('ffmpeg') && !!Bun.which('ffprobe');
const it = haveFfmpeg ? test : test.skip;

/** The ten designs a free MakeSweet account may render (from the API's own refusal message). */
const FREE = ['heart-locket', 'flag', 'billboard-cityscape', 'nesting-doll', 'circuit-board', 'bearplane', 'fortune-cookie', 'gift-box', 'back-tattoo', 'rubiks-cube'];
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40, 1)]);

let dir = '';
let job: Job;
beforeAll(async () => {
  if (!haveFfmpeg) return;
  dir = await mkdtemp(path.join(os.tmpdir(), 'bestow-ms-'));
  const c = createCanvas(320, 240), g = c.getContext('2d');
  g.fillStyle = '#f0a'; g.fillRect(0, 0, 320, 240);
  await writeFile(path.join(dir, 'in.png'), c.toBuffer('image/png'));
  job = await makeJob(dir, path.join(dir, 'in.png'));
});
afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
afterEach(() => { hooks.key = undefined; hooks.fetch = undefined; });

type Call = { url: URL; method?: string; auth: string | null; images: FormDataEntryValue[] };
/** A stand-in MakeSweet answering every request with `answer`, and recording what it was asked. */
function standIn(answer: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  hooks.key = 'msk_test'; // not a real key
  hooks.fetch = (async (url: URL, init: RequestInit) => {
    calls.push({ url: new URL(String(url)), method: init.method, auth: new Headers(init.headers).get('authorization'), images: (init.body as FormData).getAll('images[]') });
    return answer();
  }) as unknown as typeof fetch;
  return calls;
}
const ok = () => new Response(GIF, { headers: { 'content-type': 'image/gif' } });
const refuse = (status: number, body: string) => () => new Response(body, { status });

describe('the scenes and the designs they come from', () => {
  test('every scene has a MakeSweet design of its own, and the API address is MakeSweet\'s', () => {
    expect(Object.keys(SLUGS).sort()).toEqual([...TEMPLATES].sort());
    expect(new Set(Object.values(SLUGS)).size).toBe(TEMPLATES.length);
    for (const s of Object.values(SLUGS)) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(API).toBe('https://api.makesweet.com/make');
  });
  test('seven of the eleven are on the free plan; the other four need MakeSweet Deluxe', () => {
    const free = TEMPLATES.filter(t => FREE.includes(SLUGS[t]));
    expect(free.sort()).toEqual(['backtattoo', 'billboard', 'circuitboard', 'flag', 'fortunecookie', 'heartlocket', 'rubiks']);
    expect(TEMPLATES.filter(t => !FREE.includes(SLUGS[t])).sort()).toEqual(['book', 'flag2', 'toaster', 'valentine']);
  });
});

describe('what MakeSweet\'s refusals mean', () => {
  test('a wrong key, a Deluxe design, a missing design, a used-up allowance and an outage each get their own sentence', () => {
    expect(explain(401, '{"error":"You need a good Authorization header"}')).toContain('MAKESWEET_API_KEY');
    expect(explain(402, '{"error":"\'toast\' comes with a MakeSweet Deluxe membership."}')).toContain('Deluxe');
    expect(explain(404, '{"error":"i seek the template everywhere"}')).toContain('doesn\'t have that scene');
    expect(explain(429, '')).toContain('used up');
    expect(explain(503, '<html>bad gateway</html>')).toContain('trouble');
  });
  test('anything else says what MakeSweet said, trimmed, whether it sent JSON or plain text', () => {
    expect(explain(400, '{"error":"too many images"}')).toBe('MakeSweet couldn\'t make that: “too many images”');
    expect(explain(400, 'plain   text\nreason')).toBe('MakeSweet couldn\'t make that: “plain text reason”');
    expect(explain(400, '')).toBe('MakeSweet couldn\'t make that.');
    expect(explain(403, `{"error":"${'x'.repeat(500)}"}`).length).toBeLessThan(300);
  });
});

describe('asking MakeSweet', () => {
  it('sends one POST to the scene\'s design with the key, and the picture as images[]', async () => {
    const calls = standIn(ok);
    const out = await makesweet(job, 'flag');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('POST'); expect(calls[0]!.url.href).toBe('https://api.makesweet.com/make/flag');
    expect(calls[0]!.auth).toBe('msk_test'); expect(calls[0]!.images).toHaveLength(1);
    const file = calls[0]!.images[0] as File; expect(file.type).toBe('image/png'); expect(file.size).toBeGreaterThan(50);
    expect(out).toEqual({ file: 'out.gif', name: 'flag.gif' });
    expect((await Bun.file(path.join(dir, 'out.gif')).bytes()).length).toBe(GIF.length);
  });

  it('adds the text as a query parameter, tidied, and a second picture after the first', async () => {
    const calls = standIn(ok);
    await makesweet(job, 'heartlocket', { text: '  I   love\nyou  ' });
    expect(calls[0]!.url.searchParams.get('text')).toBe('I love you');
    await makesweet(job, 'heartlocket', { image2: job });
    expect(calls[1]!.images).toHaveLength(2); expect(calls[1]!.url.search).toBe('');
    await makesweet(job, 'heartlocket', { text: '   ' });
    expect(calls[2]!.url.search).toBe(''); // blank text is no text
  });

  it('turns the GIF into an mp4 on request', async () => {
    const gifPath = path.join(dir, 'real.gif');
    const { ffmpeg } = await import('../src/framework/media');
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=63x47:rate=5:duration=1', 'real.gif'], { cwd: dir });
    const real = await Bun.file(gifPath).bytes();
    standIn(() => new Response(real));
    const out = await makesweet(job, 'rubiks', { output: 'mp4' });
    expect(out).toEqual({ file: 'out.mp4', name: 'rubiks.mp4' });
    const { probe } = await import('../src/framework/media');
    const p = await probe(path.join(dir, 'out.mp4'), dir);
    expect(p.videoCodec).toBe('h264'); expect(p.width % 2).toBe(0); expect(p.height % 2).toBe(0); // odd sizes are made even for h264
  });

  it('without a key it says how to get one, and asks MakeSweet nothing', async () => {
    const calls = standIn(ok); hooks.key = '   ';
    const err = await makesweet(job, 'flag').catch(e => e);
    expect(err).toBeInstanceOf(MediaError); expect(err.message).toContain('MAKESWEET_API_KEY'); expect(err.message).toContain('api.makesweet.com');
    expect(calls).toHaveLength(0);
  });

  it('a refusal becomes a plain message and leaves no file behind to be sent', async () => {
    standIn(refuse(402, '{"error":"\'toast\' comes with a MakeSweet Deluxe membership."}'));
    await rm(path.join(dir, 'out.gif'), { force: true });
    const err = await makesweet(job, 'toaster').catch(e => e);
    expect(err).toBeInstanceOf(MediaError); expect(err.message).toContain('Deluxe');
    expect(await Bun.file(path.join(dir, 'out.gif')).exists()).toBe(false);
  });

  it('an answer that is not a GIF, a network failure and a timeout are each reported, not thrown raw', async () => {
    standIn(() => new Response('<html>oops</html>', { status: 200 }));
    expect((await makesweet(job, 'flag').catch(e => e)).message).toContain('isn\'t a picture');
    standIn(() => { throw new TypeError('fetch failed'); });
    expect((await makesweet(job, 'flag').catch(e => e)).message).toContain('couldn\'t reach MakeSweet');
    standIn(() => { throw new DOMException('The operation timed out.', 'TimeoutError'); });
    expect((await makesweet(job, 'flag').catch(e => e)).message).toContain('took too long');
  });
});
