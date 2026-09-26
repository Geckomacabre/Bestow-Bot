import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { probe } from '../src/framework/media';
import { imageSubs, videoSubs, audioSubs, mediaDirectSubs, makesweetSubs } from '../src/subcommands/media/media';
import { hooks as makesweetHooks } from '../src/media/makesweet';
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
  dir = await mkdtemp(path.join(os.tmpdir(), 'bestow-cmd-test-'));
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

  it('meme with top|bottom text in one option, like Heist', async () => {
    const r = await runSub(find(imageSubs, 'meme'), { attachments: { image: att('sample.png', 'image/png') }, options: { text: 'top|bottom' } });
    expect(r.data).not.toBeNull();
    const none = await runSub(find(imageSubs, 'meme'), { attachments: { image: att('sample.png', 'image/png') } });
    expect(textOf(none.payload)).toContain('Give me some text');
  }, 60_000);

  it('caption takes a second caption for the bottom, and togif turns a still into a GIF', async () => {
    const one = await runSub(find(imageSubs, 'caption'), { attachments: { image: att('sample.png', 'image/png') }, options: { caption: 'top' } });
    const two = await runSub(find(imageSubs, 'caption'), { attachments: { image: att('sample.png', 'image/png') }, options: { caption: 'top', caption_bottom: 'bottom' } });
    const [h1, h2] = [(await probeBuffer(one.data!, 'png')).height, (await probeBuffer(two.data!, 'png')).height];
    expect(h1).toBeGreaterThan(400); expect(h2).toBeGreaterThan(h1);
    const gif = await runSub(find(imageSubs, 'grayscale'), { attachments: { image: att('sample.png', 'image/png') }, options: { togif: true } });
    expect(gif.name).toBe('result.gif');
  }, 60_000);

  it('pixelate sizes, flip and rotate choices, watermark fonts/colours with the default text', async () => {
    for (const size of ['Small', 'Large']) expect((await runSub(find(imageSubs, 'pixelate'), { attachments: { image: att('sample.png', 'image/png') }, options: { size } })).data, size).not.toBeNull();
    const up = await runSub(find(imageSubs, 'flip'), { attachments: { image: att('sample.png', 'image/png') }, options: { direction: 'Vertical (upside down)' } });
    expect(up.data).not.toBeNull();
    const turned = await runSub(find(imageSubs, 'rotate'), { attachments: { image: att('sample.png', 'image/png') }, options: { degrees: 90 } });
    expect(await probeBuffer(turned.data!, 'png')).toMatchObject({ width: 400, height: 640 });
    for (const font of ['Impact', 'Futura Black', 'Quicksand Bold', 'Ubuntu Bold', 'Liberation Sans Bold']) {
      const r = await runSub(find(imageSubs, 'watermark'), { attachments: { image: att('sample.png', 'image/png') }, options: { font, color: 'Red', position: 'Top Left', opacity: 0.5, size: 40 } });
      expect(r.data, font).not.toBeNull();
    }
  }, 120_000);

  it('a GIF in → a GIF out', async () => {
    const r = await runSub(find(imageSubs, 'grayscale'), { attachments: { image: att('sample.gif', 'image/gif') } });
    expect(r.name).toBe('result.gif');
    expect((await probeBuffer(r.data!, 'gif')).animated).toBe(true);
  }, 60_000);

  it('overlay needs two images and composes them', async () => {
    const r = await runSub(find(imageSubs, 'overlay'), { attachments: { base: att('sample.png', 'image/png'), overlay: att('sample.png', 'image/png') }, options: { scale: 0.3, opacity: 0.8, x: 20, y: 10 } });
    expect(r.name).toBe('overlay.png');
    const bad = await runSub(find(imageSubs, 'overlay'), { attachments: { base: att('sample.mp4', 'video/mp4'), overlay: att('sample.png', 'image/png') } });
    expect(textOf(bad.payload)).toContain('Both attachments must be images');
  }, 60_000);

  it('spin, pingpong, zoomblur, fisheye, deepfry, swirl, globe, magik, motivate, speechbubble all upload something', async () => {
    for (const [name, file, ct] of [['spin', 'sample.png', 'image/png'], ['pingpong', 'sample.gif', 'image/gif'], ['zoomblur', 'sample.png', 'image/png'], ['fisheye', 'sample.png', 'image/png'], ['deepfry', 'sample.png', 'image/png'],
      ['swirl', 'sample.png', 'image/png'], ['globe', 'sample.png', 'image/png'], ['magik', 'sample.gif', 'image/gif'], ['speechbubble', 'sample.png', 'image/png']] as const) {
      const r = await runSub(find(imageSubs, name), { attachments: { image: att(file, ct) } });
      expect(r.data, name).not.toBeNull();
    }
    const m = await runSub(find(imageSubs, 'motivate'), { attachments: { image: att('sample.png', 'image/png') }, options: { text: 'Teamwork|it makes the dream work' } });
    expect(m.name).toBe('motivate.png');
  }, 180_000);

  it('addaudio (now under /media image) loops, trims and applies an effect', async () => {
    const r = await runSub(find(imageSubs, 'addaudio'), { attachments: { image: att('sample.png', 'image/png'), audio: att('sample.wav', 'audio/wav') }, options: { volume: 0.8, loop: 2, effect: 'Fade In' } });
    const p = await probeBuffer(r.data!, 'mp4');
    expect(p).toMatchObject({ hasAudio: true, hasVideo: true });
  }, 60_000);
});

describe('/media makesweet (MakeSweet\'s own API, here answered by a stand-in)', () => {
  /** What the stand-in was asked; it answers with a real GIF, as MakeSweet does. */
  const asked: { url: URL; auth: string | null; images: number }[] = [];
  beforeAll(() => {
    makesweetHooks.key = 'test-key';
    makesweetHooks.fetch = (async (url: URL, init: RequestInit) => {
      asked.push({ url: new URL(String(url)), auth: new Headers(init.headers).get('authorization'), images: (init.body as FormData).getAll('images[]').length });
      return new Response(Bun.file(path.join(dir, 'sample.gif')), { headers: { 'content-type': 'image/gif' } });
    }) as unknown as typeof fetch;
  });
  afterAll(() => { makesweetHooks.key = undefined; makesweetHooks.fetch = undefined; });

  it('renders a scene as a GIF by default and an MP4 on request', async () => {
    const gif = await runSub(find(makesweetSubs, 'flag'), { attachments: { image: att('sample.png', 'image/png') } });
    expect(gif.name).toBe('flag.gif');
    expect((await probeBuffer(gif.data!, 'gif')).animated).toBe(true);
    const mp4 = await runSub(find(makesweetSubs, 'rubiks'), { attachments: { image: att('sample.png', 'image/png') }, options: { output: 'MP4' } });
    expect(mp4.name).toBe('rubiks.mp4');
    expect((await probeBuffer(mp4.data!, 'mp4')).videoCodec).toBe('h264');
  }, 120_000);
  it('each scene is asked of MakeSweet by its own design name, with the key, one picture and no text', async () => {
    asked.length = 0;
    await runSub(find(makesweetSubs, 'billboard'), { attachments: { image: att('sample.png', 'image/png') } });
    expect(asked).toHaveLength(1);
    expect(asked[0]!.url.origin + asked[0]!.url.pathname).toBe('https://api.makesweet.com/make/billboard-cityscape');
    expect(asked[0]!.auth).toBe('test-key'); expect(asked[0]!.images).toBe(1); expect(asked[0]!.url.search).toBe('');
  }, 60_000);
  it('the heart locket takes a second image or text, not both — and sends whichever it was given', async () => {
    const both = await runSub(find(makesweetSubs, 'heartlocket'), { attachments: { image: att('sample.png', 'image/png'), image2: att('sample.png', 'image/png') }, options: { text: 'hi' } });
    expect(textOf(both.payload)).toContain('not both');
    asked.length = 0;
    const two = await runSub(find(makesweetSubs, 'heartlocket'), { attachments: { image: att('sample.png', 'image/png'), image2: att('sample.gif', 'image/gif') } });
    expect(two.name).toBe('heartlocket.gif'); expect(asked[0]!.images).toBe(2);
    await runSub(find(makesweetSubs, 'heartlocket'), { attachments: { image: att('sample.png', 'image/png') }, options: { text: 'love you' } });
    expect(asked[1]!.images).toBe(1); expect(asked[1]!.url.searchParams.get('text')).toBe('love you');
  }, 120_000);
});

describe('video and audio commands end-to-end', () => {
  it('video speed uploads an mp4 of about half the length', async () => {
    const r = await runSub(find(videoSubs, 'speed'), { attachments: { video: att('sample.mp4', 'video/mp4') }, options: { multiplier: '2x (fast)' } });
    const p = await probeBuffer(r.data!, 'mp4');
    expect(p.duration).toBeLessThan(1.4);
  }, 60_000);

  it('video crop uses Heist\'s ratio and anchor choices', async () => {
    const r = await runSub(find(videoSubs, 'crop'), { attachments: { video: att('sample.mp4', 'video/mp4') }, options: { ratio: '1:1 (square)', anchor: 'Left' } });
    expect(await probeBuffer(r.data!, 'mp4')).toMatchObject({ width: 240, height: 240 });
  }, 60_000);

  it('output: GIF and audio: false work across the video tools', async () => {
    const gif = await runSub(find(videoSubs, 'reverse'), { attachments: { video: att('sample.mp4', 'video/mp4') }, options: { output: 'GIF' } });
    expect(gif.name).toBe('reversed.gif');
    expect((await probeBuffer(gif.data!, 'gif')).animated).toBe(true);
    const mute = await runSub(find(videoSubs, 'resize'), { attachments: { video: att('sample.mp4', 'video/mp4') }, options: { scale: 2, audio: false } });
    expect(await probeBuffer(mute.data!, 'mp4')).toMatchObject({ width: 640, height: 480, hasAudio: false });
    const bubble = await runSub(find(videoSubs, 'speechbubble'), { attachments: { video: att('sample.mp4', 'video/mp4') }, options: { style: 'Flux' } });
    expect((await probeBuffer(bubble.data!, 'mp4')).hasAudio).toBe(true);
    const wm = await runSub(find(videoSubs, 'watermark'), { attachments: { video: att('sample.mp4', 'video/mp4') }, options: { text: 'wm', color: 'Yellow' } });
    expect(wm.name).toBe('result.mp4');
  }, 180_000);

  it('audio effects accept audio files and video files', async () => {
    const a = await runSub(find(audioSubs, 'nightcore'), { attachments: { file: att('sample.wav', 'audio/wav') } });
    expect(a.name).toBe('nightcore.mp3');
    const v = await runSub(find(audioSubs, '8d'), { attachments: { file: att('sample.mp4', 'video/mp4') } });
    expect(v.data).not.toBeNull();
    const loud = await runSub(find(audioSubs, 'earrape'), { attachments: { file: att('sample.wav', 'audio/wav') }, options: { level: 3 } });
    expect(loud.name).toBe('earrape.mp3');
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

  it('ahshit keys CJ over an image or a video, with the line and its audio', async () => {
    for (const o of [{ attachments: { image: att('sample.png', 'image/png') } }, { options: { url: `${base}/sample.mp4` } }]) {
      const r = await runSub(find(mediaDirectSubs, 'ahshit'), o);
      expect(r.name).toBe('ahshit.mp4');
      const p = await probeBuffer(r.data!, 'mp4');
      expect(p).toMatchObject({ width: 1280, height: 720, hasAudio: true });
      expect(p.duration).toBeGreaterThan(2.95); expect(p.duration).toBeLessThan(3.3); // the template's full 3.04 s
    }
  }, 90_000);

  it('plain ahshit sends the clip itself, untouched; a bad link is still an error', async () => {
    const r = await runSub(find(mediaDirectSubs, 'ahshit'), {});
    const { AHSHIT_CLIP } = await import('../src/media/fx2');
    expect(r.data!.equals(Buffer.from(await Bun.file(AHSHIT_CLIP).arrayBuffer()))).toBe(true);
    const bad = await runSub(find(mediaDirectSubs, 'ahshit'), { options: { url: `${base}/does-not-exist.png` } });
    expect(bad.data).toBeNull();
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
