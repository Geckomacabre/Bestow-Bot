import { beforeAll, describe, expect, test } from 'bun:test';
import path from 'node:path';
import { mkdtemp, rm, stat, copyFile } from 'node:fs/promises';
import os from 'node:os';
import { probe, fitEven, withWorkdir } from '../src/framework/media';
import * as fx from '../src/media/effects';
import { imageWithAudio2 } from '../src/media/fx2';
import { makeSamples } from './fixtures';

const haveFfmpeg = !!Bun.which('ffmpeg') && !!Bun.which('ffprobe');
const it = haveFfmpeg ? test : test.skip;

let dir = '';
beforeAll(async () => {
  if (!haveFfmpeg) return;
  dir = await mkdtemp(path.join(os.tmpdir(), 'bestow-media-test-'));
  await makeSamples(dir);
});

const job = async (file: string) => fx.makeJob(dir, file);
const info = async (out: fx.Out) => probe(out.file, dir);

describe('pure helpers', () => {
  test('wrapText respects the budget and hard-splits long words', () => {
    expect(fx.wrapText('the quick brown fox jumps', 10)).toEqual(['the quick', 'brown fox', 'jumps']);
    expect(fx.wrapText('supercalifragilistic', 8)).toEqual(['supercal', 'ifragili', 'stic']);
    expect(fx.wrapText('a\nb', 10)).toEqual(['a', 'b']);
  });
  test('stripUnsupported removes emoji', () => {
    expect(fx.stripUnsupported('hi 😀 there 🎉')).toBe('hi  there');
    expect(fx.stripUnsupported('plain')).toBe('plain');
  });
  test('atempoChain keeps every stage in 0.5–2× and the product right', () => {
    for (const m of [0.25, 0.5, 1, 1.5, 3, 4]) {
      const stages = fx.atempoChain(m).split(',').map(s => Number(s.split('=')[1]));
      for (const s of stages) { expect(s).toBeGreaterThanOrEqual(0.5); expect(s).toBeLessThanOrEqual(2); }
      expect(stages.reduce((a, b) => a * b, 1)).toBeCloseTo(m, 3);
    }
  });
  test('fitEven caps the long side and keeps dimensions even', () => {
    const r = fitEven(3001, 1501, 1280);
    expect(Math.max(r.w, r.h)).toBeLessThanOrEqual(1282);
    expect(r.w % 2).toBe(0); expect(r.h % 2).toBe(0);
    expect(fitEven(100, 50, 1280)).toEqual({ w: 100, h: 50 });
  });
  test('audio filters exist for every effect', () => {
    for (const e of fx.AUDIO_EFFECTS) expect(fx.audioFilter(e.value, 44100).length).toBeGreaterThan(3);
  });
  test('workdir is created and removed', async () => {
    let seen = '';
    await withWorkdir(async d => { seen = d; expect((await stat(d)).isDirectory()).toBe(true); });
    await expect(stat(seen)).rejects.toThrow();
  });
});

describe('probing', () => {
  it('classifies stills, gifs, video and audio', async () => {
    const png = await probe('sample.png', dir), gif = await probe('sample.gif', dir), mp4 = await probe('sample.mp4', dir), wav = await probe('sample.wav', dir);
    expect(png).toMatchObject({ width: 640, height: 400, animated: false, hasVideo: true });
    expect(gif.animated).toBe(true);
    expect(mp4).toMatchObject({ width: 320, height: 240, hasAudio: true, animated: true });
    expect(mp4.duration).toBeGreaterThan(1.5);
    expect(wav).toMatchObject({ hasAudio: true, hasVideo: false });
  });
});

describe('image effects (still)', () => {
  const cases: [string, (j: fx.Job) => Promise<fx.Out>][] = [
    ['blur', j => fx.blur(j, 8)], ['invert', fx.invert], ['grayscale', fx.grayscale], ['flip h', j => fx.flip(j, 'horizontal')],
    ['pixelate', j => fx.pixelate(j, 16)], ['rotate 45', j => fx.rotate(j, 45)], ['fisheye', fx.fisheye], ['zoomblur', j => fx.zoomBlur(j, 5)],
    ['deepfry', fx.deepfry], ['togif', fx.toGif],
  ];
  for (const [name, f] of cases) {
    it(`${name} produces a valid file`, async () => {
      const out = await f(await job('sample.png'));
      const p = await info(out);
      expect(p.width).toBeGreaterThan(10);
      expect(p.height).toBeGreaterThan(10);
      expect((await stat(path.join(dir, out.file))).size).toBeGreaterThan(500);
    }, 60_000);
  }

  it('rotate 90 swaps the dimensions; pixelate keeps them', async () => {
    const r = await info(await fx.rotate(await job('sample.png'), 90));
    expect([r.width, r.height]).toEqual([400, 640]);
    const p = await info(await fx.pixelate(await job('sample.png'), 20));
    expect([p.width, p.height]).toEqual([640, 400]);
  });

  it('deepfry outputs a JPEG', async () => {
    expect((await fx.deepfry(await job('sample.png'))).name).toBe('result.jpg');
  });

  it('caption adds a bar (height grows), meme keeps the size', async () => {
    const c = await info(await fx.caption(await job('sample.png'), 'this is a long caption that needs to wrap over a couple of lines'));
    expect(c.width).toBe(640);
    expect(c.height).toBeGreaterThan(400);
    const m = await info(await fx.meme(await job('sample.png'), 'top text', 'bottom text'));
    expect([m.width, m.height]).toEqual([640, 400]);
  });

  it('caption/meme reject empty text after stripping emoji', async () => {
    await expect(fx.caption(await job('sample.png'), '😀😀')).rejects.toThrow();
    await expect(fx.meme(await job('sample.png'), '', '')).rejects.toThrow();
  });

  it('user text never reaches the filter string (quotes, colons, backslashes, %{})', async () => {
    const nasty = `it's: 100% \\o/ %{pts} '; drawtext=`;
    const out = await fx.caption(await job('sample.png'), nasty);
    expect((await info(out)).height).toBeGreaterThan(400);
    const wm = await fx.watermark(await job('sample.png'), nasty, { position: 'bottom-right', opacity: 0.6, size: 20, color: '#ffffff' });
    expect((await info(wm)).width).toBe(640);
  });

  it('watermark supports every position', async () => {
    for (const position of fx.POSITIONS) {
      const out = await fx.watermark(await job('sample.png'), 'bestow', { position, opacity: 0.7, size: 24, color: '#ffcc00' });
      expect((await info(out)).width).toBe(640);
    }
  }, 120_000);
});

describe('animated inputs', () => {
  it('a GIF stays a GIF through an image effect', async () => {
    const out = await fx.invert(await job('sample.gif'));
    expect(out.name.endsWith('.gif')).toBe(true);
    expect((await info(out)).animated).toBe(true);
  }, 60_000);

  it('pingpong doubles the duration; refuses stills', async () => {
    const src = await probe('sample.gif', dir);
    const out = await info(await fx.pingpong(await job('sample.gif')));
    expect(out.duration).toBeGreaterThan(src.duration * 1.5);
    await expect(fx.pingpong(await job('sample.png'))).rejects.toThrow();
  }, 60_000);

  it('spin makes a looping GIF from a still', async () => {
    const out = await fx.spin(await job('sample.png'));
    const p = await info(out);
    expect(p.animated).toBe(true);
    expect(p.width).toBe(p.height);
  }, 60_000);
});

describe('video', () => {
  const ops: [string, (j: fx.Job) => Promise<fx.Out>][] = [
    ['reverse', fx.videoReverse], ['scramble', fx.videoScramble], ['rotate 90', j => fx.videoRotate(j, 90)], ['resize 0.5', j => fx.videoResize(j, 0.5)],
    ['crop 1:1', j => fx.videoCrop(j, '1:1', 'center')], ['speed 2', j => fx.videoSpeed(j, 2)],
  ];
  for (const [name, f] of ops) {
    it(`${name} outputs a playable mp4`, async () => {
      const out = await f(await job('sample.mp4'));
      const p = await info(out);
      expect(p.videoCodec).toBe('h264');
      expect(p.width % 2).toBe(0); expect(p.height % 2).toBe(0);
      expect(p.duration).toBeGreaterThan(0.3);
    }, 60_000);
  }

  it('geometry results are right', async () => {
    expect((await info(await fx.videoResize(await job('sample.mp4'), 0.5)))).toMatchObject({ width: 160, height: 120 });
    expect((await info(await fx.videoCrop(await job('sample.mp4'), '1:1', 'center')))).toMatchObject({ width: 240, height: 240 });
    const r = await info(await fx.videoRotate(await job('sample.mp4'), 90));
    expect([r.width, r.height]).toEqual([240, 320]);
  }, 90_000);

  it('speed 2 halves the duration, keeping audio in sync', async () => {
    const out = await info(await fx.videoSpeed(await job('sample.mp4'), 2));
    expect(out.duration).toBeGreaterThan(0.8);
    expect(out.duration).toBeLessThan(1.4);
    expect(out.hasAudio).toBe(true);
  }, 60_000);

  it('video caption + watermark keep it a video', async () => {
    const c = await info(await fx.caption(await job('sample.mp4'), 'hello world', { video: true }));
    expect(c.videoCodec).toBe('h264');
    expect(c.height).toBeGreaterThan(240);
    const w = await info(await fx.watermark(await job('sample.mp4'), 'wm', { position: 'top-left', opacity: 0.8, size: 24, color: '#ffffff' }, true));
    expect(w.videoCodec).toBe('h264');
  }, 90_000);

  it('rejects a bad crop ratio', async () => {
    await expect(async () => fx.videoCrop(await job('sample.mp4'), 'wide', 'center')).toThrow();
  });

  it('togif from video', async () => {
    const out = await fx.toGif(await job('sample.mp4'));
    expect(out.name).toBe('result.gif');
    expect((await info(out)).animated).toBe(true);
  }, 60_000);

  it('video-only file: reverse works without an audio track', async () => {
    const { ffmpeg } = await import('../src/framework/media');
    await ffmpeg(['-i', 'sample.mp4', '-an', '-c:v', 'copy', 'silent.mp4'], { cwd: dir });
    const out = await info(await fx.videoReverse(await job('silent.mp4')));
    expect(out.hasAudio).toBe(false);
  }, 60_000);
});

describe('image + audio → video', () => {
  it('builds a video of the audio\'s length, times the loops, trimmed to start/end', async () => {
    const once = await info(await imageWithAudio2(dir, 'sample.png', 'sample.wav', { loop: 1, volume: 1, start: 0, end: 0, effect: null }));
    expect(once.hasAudio).toBe(true);
    expect(once.videoCodec).toBe('h264');
    expect(once.duration).toBeGreaterThan(2.5);
    expect(once.duration).toBeLessThan(3.8);
    const twice = await info(await imageWithAudio2(dir, 'sample.png', 'sample.wav', { loop: 2, volume: 0.5, start: 1, end: 2.5, effect: 'Clear to Pixelized' }));
    expect(twice.duration).toBeGreaterThan(2.6);
    expect(twice.duration).toBeLessThan(3.6);
  }, 60_000);
});

describe('audio effects', () => {
  for (const e of fx.AUDIO_EFFECTS) {
    it(`${e.value} produces an mp3`, async () => {
      const out = await fx.audioEffect(await job('sample.wav'), e.value);
      const p = await info(out);
      expect(p.hasAudio).toBe(true);
      expect(p.hasVideo).toBe(false);
      expect(p.duration).toBeGreaterThan(1);
    }, 60_000);
  }

  it('nightcore is shorter, slowed is longer (tempo really changes)', async () => {
    const base = (await probe('sample.wav', dir)).duration;
    const nc = (await info(await fx.audioEffect(await job('sample.wav'), 'nightcore'))).duration;
    const sl = (await info(await fx.audioEffect(await job('sample.wav'), 'slowedandreverb'))).duration;
    expect(nc).toBeLessThan(base * 0.9);
    expect(sl).toBeGreaterThan(base * 1.1);
  }, 90_000);

  it('works on the audio track of a video, and rejects files with no audio', async () => {
    expect((await info(await fx.audioEffect(await job('sample.mp4'), '8d'))).hasAudio).toBe(true);
    const { ffmpeg } = await import('../src/framework/media');
    await ffmpeg(['-i', 'sample.mp4', '-an', '-c:v', 'copy', 'mute.mp4'], { cwd: dir });
    await expect(fx.audioEffect(await job('mute.mp4'), 'reverse')).rejects.toThrow(/no audio/);
  }, 60_000);

  it('earrape level changes the loudness settings', () => {
    expect(fx.audioFilter('earrape', 44100, 1)).not.toBe(fx.audioFilter('earrape', 44100, 5));
  });
});

// keep a copy of the artefacts around when asked (used for eyeballing results)
if (Bun.env.KEEP_MEDIA) {
  test('keep', async () => { await copyFile(path.join(dir, 'sample.png'), path.join(Bun.env.KEEP_MEDIA!, 'sample.png')); });
}
