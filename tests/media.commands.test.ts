import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { probe } from '../src/framework/media';
import { imageSubs, videoSubs, audioSubs, mediaDirectSubs } from '../src/subcommands/media/media';
import { fakeInteraction, textOf } from './fakeInteraction';
import { makeSamples } from './fixtures';

const haveFfmpeg = !!Bun.which('ffmpeg') && !!Bun.which('ffprobe');
const it = haveFfmpeg ? test : test.skip;

let dir = '';
let server: ReturnType<typeof Bun.serve>;
let base = '';

beforeAll(async () => {
  Bun.env.ALLOW_PRIVATE_URLS = '1';
  if (!haveFfmpeg) return;
  dir = await mkdtemp(path.join(os.tmpdir(), 'onyx-cmd-test-'));
  await makeSamples(dir);
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const name = new URL(req.url).pathname.slice(1);
      const f = Bun.file(path.join(dir, name));
      return f.size ? new Response(f, { headers: { 'content-type': f.type } }) : new Response('nope', { status: 404 });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(() => { delete Bun.env.ALLOW_PRIVATE_URLS; server?.stop(true); });

const att = (file: string, contentType: string) => ({ url: `${base}/${file}`, name: file, contentType });
const find = (subs: { name: string; run: (i: any) => Promise<unknown> }[], name: string) => subs.find(s => s.name === name)!;

/** Run a sub and return what it uploaded (bytes) plus the interaction record. */
async function runSub(sub: { run: (i: any) => Promise<unknown> }, o: Parameters<typeof fakeInteraction>[0]) {
  const f = fakeInteraction(o);
  await sub.run(f.interaction);
  const payload = f.last();
  const file = payload?.files?.[0];
  const data: Buffer | null = file ? Buffer.from(file.attachment) : null;
  return { ...f, payload, file, data, name: file?.name as string | undefined };
}

async function probeBuffer(data: Buffer, ext: string) {
  const p = path.join(dir, `probe-${Math.random().toString(36).slice(2)}.${ext}`);
  await Bun.write(p, data);
  return probe(p);
}

describe('image commands end-to-end (fake Discord interaction, real download + ffmpeg)', () => {
  it('blur via attachment uploads a valid PNG', async () => {
    const r = await runSub(find(imageSubs, 'blur'), { attachments: { image: att('sample.png', 'image/png') }, options: { strength: 12 } });
    expect(r.name).toBe('result.png');
    expect(r.data!.length).toBeGreaterThan(1000);
    expect(await probeBuffer(r.data!, 'png')).toMatchObject({ width: 640, height: 400 });
  }, 60_000);

  it('works from a plain url option too', async () => {
    const r = await runSub(find(imageSubs, 'invert'), { options: { url: `${base}/sample.png` } });
    expect(r.name).toBe('result.png');
  }, 60_000);

  it('meme with top and bottom text', async () => {
    const r = await runSub(find(imageSubs, 'meme'), { attachments: { image: att('sample.png', 'image/png') }, options: { top: 'top', bottom: 'bottom' } });
    expect(r.data).not.toBeNull();
  }, 60_000);

  it('a GIF in → a GIF out', async () => {
    const r = await runSub(find(imageSubs, 'grayscale'), { attachments: { image: att('sample.gif', 'image/gif') } });
    expect(r.name).toBe('result.gif');
    expect((await probeBuffer(r.data!, 'gif')).animated).toBe(true);
  }, 60_000);

  it('overlay needs two images and composes them', async () => {
    const r = await runSub(find(imageSubs, 'overlay'), { attachments: { base: att('sample.png', 'image/png'), overlay: att('sample.png', 'image/png') }, options: { scale: 30, opacity: 80 } });
    expect(r.name).toBe('overlay.png');
    const bad = await runSub(find(imageSubs, 'overlay'), { attachments: { base: att('sample.mp4', 'video/mp4'), overlay: att('sample.png', 'image/png') } });
    expect(textOf(bad.payload)).toContain('Both attachments must be images');
  }, 60_000);

  it('spin, pingpong, zoomblur, fisheye, deepfry all upload something', async () => {
    for (const [name, file, ct] of [['spin', 'sample.png', 'image/png'], ['pingpong', 'sample.gif', 'image/gif'], ['zoomblur', 'sample.png', 'image/png'], ['fisheye', 'sample.png', 'image/png'], ['deepfry', 'sample.png', 'image/png']] as const) {
      const r = await runSub(find(imageSubs, name), { attachments: { image: att(file, ct) } });
      expect(r.data, name).not.toBeNull();
    }
  }, 120_000);
});

describe('video and audio commands end-to-end', () => {
  it('video speed uploads an mp4 of about half the length', async () => {
    const r = await runSub(find(videoSubs, 'speed'), { attachments: { video: att('sample.mp4', 'video/mp4') }, options: { multiplier: 2 } });
    const p = await probeBuffer(r.data!, 'mp4');
    expect(p.duration).toBeLessThan(1.4);
  }, 60_000);

  it('video crop with a bad ratio reports a friendly error, not a crash', async () => {
    const r = await runSub(find(videoSubs, 'crop'), { attachments: { video: att('sample.mp4', 'video/mp4') }, options: { ratio: 'nonsense' } });
    expect(r.data).toBeNull();
    expect(textOf(r.payload)).toContain('ratio');
  }, 60_000);

  it('audio effects accept audio files and video files', async () => {
    const a = await runSub(find(audioSubs, 'nightcore'), { attachments: { file: att('sample.wav', 'audio/wav') } });
    expect(a.name).toBe('nightcore.mp3');
    const v = await runSub(find(audioSubs, '8d'), { attachments: { file: att('sample.mp4', 'video/mp4') } });
    expect(v.data).not.toBeNull();
  }, 90_000);

  it('audio on a silent video says so', async () => {
    const { ffmpeg } = await import('../src/framework/media');
    await ffmpeg(['-i', 'sample.mp4', '-an', '-c:v', 'copy', 'silent2.mp4'], { cwd: dir });
    const r = await runSub(find(audioSubs, 'reverse'), { attachments: { file: att('silent2.mp4', 'video/mp4') } });
    expect(textOf(r.payload).toLowerCase()).toContain('no audio');
  }, 60_000);
});

describe('direct media commands', () => {
  it('info reports dimensions and duration', async () => {
    const r = await runSub(find(mediaDirectSubs, 'info'), { attachments: { media: att('sample.mp4', 'video/mp4') } });
    const t = textOf(r.payload);
    expect(t).toContain('320×240');
    expect(t).toContain('Video');
  }, 60_000);

  it('frames returns a ZIP with several PNGs', async () => {
    const r = await runSub(find(mediaDirectSubs, 'frames'), { attachments: { media: att('sample.gif', 'image/gif') } });
    expect(r.name).toBe('frames.zip');
    const eocd = r.data!.length - 22;
    expect(r.data!.readUInt32LE(eocd)).toBe(0x06054b50);
    expect(r.data!.readUInt16LE(eocd + 10)).toBeGreaterThan(3);
  }, 60_000);

  it('frames rejects a still image', async () => {
    const r = await runSub(find(mediaDirectSubs, 'frames'), { attachments: { media: att('sample.png', 'image/png') } });
    expect(textOf(r.payload)).toContain('only one frame');
    const a = await runSub(find(mediaDirectSubs, 'frames'), { attachments: { media: att('sample.wav', 'audio/wav') } });
    expect(textOf(a.payload)).toContain('no video frames');
  }, 60_000);

  it('addaudio builds a video from an image and a sound', async () => {
    const r = await runSub(find(mediaDirectSubs, 'addaudio'), { attachments: { image: att('sample.png', 'image/png'), audio: att('sample.wav', 'audio/wav') }, options: { volume: 80 } });
    const p = await probeBuffer(r.data!, 'mp4');
    expect(p).toMatchObject({ hasAudio: true, hasVideo: true });
  }, 60_000);
});

describe('guard rails', () => {
  it('an over-limit result is refused with a clear message', async () => {
    const r = await runSub(find(imageSubs, 'invert'), { attachments: { image: att('sample.png', 'image/png') }, limit: 2000 });
    expect(r.data).toBeNull();
    expect(textOf(r.payload)).toMatch(/upload limit/);
  }, 60_000);

  it('a wrong attachment type is refused before downloading', async () => {
    const r = await runSub(find(imageSubs, 'invert'), { attachments: { image: att('sample.wav', 'audio/wav') } });
    expect(textOf(r.payload).toLowerCase()).toContain('image');
  });

  it('a dead link gives a friendly error', async () => {
    const r = await runSub(find(imageSubs, 'invert'), { options: { url: `${base}/does-not-exist.png` } });
    expect(r.data).toBeNull();
    expect(textOf(r.payload)).toContain('❌');
  });

  it('a corrupt file gives a friendly error', async () => {
    await Bun.write(path.join(dir, 'broken.png'), Buffer.from('not really an image'));
    const r = await runSub(find(imageSubs, 'invert'), { attachments: { image: att('broken.png', 'image/png') } });
    expect(r.data).toBeNull();
    expect(textOf(r.payload)).toContain('❌');
  }, 60_000);

  it('SSRF: private addresses are refused when the test escape hatch is off', async () => {
    delete Bun.env.ALLOW_PRIVATE_URLS;
    for (const u of ['http://127.0.0.1/x.png', 'http://localhost:8080/x.png', 'http://192.168.1.10/x.png', 'http://10.0.0.5/x.png', 'http://169.254.169.254/latest/meta-data', 'http://172.16.0.1/x.png', 'file:///etc/passwd', 'ftp://example.com/x.png']) {
      const r = await runSub(find(imageSubs, 'invert'), { options: { url: u } });
      expect(r.data, u).toBeNull();
      expect(textOf(r.payload), u).toContain('❌');
    }
    Bun.env.ALLOW_PRIVATE_URLS = '1';
  });
});
