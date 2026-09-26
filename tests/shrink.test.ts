import { describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MediaError, ffmpeg, probe, withWorkdir, type Probe } from '../src/framework/media';
import { ATTEMPTS, AUDIO_KBPS, MIN_VIDEO_KBPS, shrinkArgs, shrinkVideo, videoKbps } from '../src/media/shrink';

const hasFfmpeg = !!Bun.which(Bun.env.FFMPEG_PATH ?? 'ffmpeg') && !!Bun.which(Bun.env.FFPROBE_PATH ?? 'ffprobe');
const real = hasFfmpeg ? test : test.skip;

const info = (o: Partial<Probe> = {}): Probe => ({ duration: 30, width: 720, height: 1280, fps: 30, frames: 900, hasVideo: true, hasAudio: true, audioRate: 44100, format: 'mov,mp4', size: 12_000_000, animated: true, videoCodec: 'h264', ...o });
const mp4 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31, 0xff, 0xfe, 0x80, 0x90]); // starts like a real file, not like text

describe('the bitrate that fits', () => {
  test('is what the limit allows for the length, minus the audio', () => {
    // 10 MB × 0.88 over 30 s, in kbit/s, less 64 for the sound
    expect(videoKbps(10_000_000, 30, 0.88, true)).toBe(Math.floor((10_000_000 * 0.88 * 8) / 1000 / 30 - AUDIO_KBPS));
    expect(videoKbps(10_000_000, 30, 0.88, false)).toBeGreaterThan(videoKbps(10_000_000, 30, 0.88, true)!);
    expect(videoKbps(10_000_000, 30, 0.7, true)!).toBeLessThan(videoKbps(10_000_000, 30, 0.88, true)!);
  });
  test('a longer clip gets less, and one with no room for a decent picture gets none', () => {
    expect(videoKbps(10_000_000, 60, 0.88, true)!).toBeLessThan(videoKbps(10_000_000, 30, 0.88, true)!);
    expect(videoKbps(10_000_000, 3600, 0.88, true)).toBeNull();
    expect(videoKbps(10_000_000, 0, 0.88, true)).toBeNull(); expect(videoKbps(10_000_000, NaN, 0.88, true)).toBeNull();
    expect(MIN_VIDEO_KBPS).toBeGreaterThan(0);
  });
});

describe('the ffmpeg arguments', () => {
  test('one H.264 encode at that bitrate, with the sound kept, and an mp4 that starts playing straight away', () => {
    const a = shrinkArgs(800, true).join(' ');
    for (const part of ['-c:v libx264', '-b:v 800k', '-maxrate 919k', '-bufsize 1600k', '-c:a aac', '-b:a 64k', '-movflags +faststart', '-pix_fmt yuv420p', '-map 0:a:0']) expect(a).toContain(part);
    expect(a.endsWith('out.mp4')).toBe(true);
  });
  test('a clip with no sound gets no audio settings', () => {
    const a = shrinkArgs(800, false).join(' ');
    expect(a).not.toContain('aac'); expect(a).not.toContain('0:a:0');
  });
  test('the picture is only scaled down harder when the bitrate is small', () => {
    expect(shrinkArgs(900, true).join(' ')).toContain('min(720,');
    expect(shrinkArgs(300, true).join(' ')).toContain('min(480,');
  });
});

describe('shrinkVideo (with a fake ffmpeg)', () => {
  const fake = (sizes: number[]) => {
    const calls: string[][] = [];
    return {
      calls,
      ffmpeg: async (args: string[], o: { cwd: string }) => { calls.push(args); await writeFile(path.join(o.cwd, 'out.mp4'), Buffer.alloc(sizes[calls.length - 1] ?? sizes.at(-1)!, 2)); },
    };
  };
  test('one encode is enough when it comes out under the limit', async () => {
    const f = fake([9_000_000]);
    const out = await shrinkVideo(mp4, 10_000_000, { probe: async () => info(), ffmpeg: f.ffmpeg });
    expect(out).toHaveLength(9_000_000); expect(f.calls).toHaveLength(1);
  });
  test('an encode that overshoots is redone smaller', async () => {
    const f = fake([10_400_000, 8_000_000]);
    const out = await shrinkVideo(mp4, 10_000_000, { probe: async () => info(), ffmpeg: f.ffmpeg });
    expect(out).toHaveLength(8_000_000); expect(f.calls).toHaveLength(ATTEMPTS.length);
    const kbps = (a: string[]) => Number(a[a.indexOf('-b:v') + 1]!.replace('k', ''));
    expect(kbps(f.calls[1]!)).toBeLessThan(kbps(f.calls[0]!));
  });
  test('if every attempt is over, or the clip is too long for a decent picture, it says so', async () => {
    await expect(shrinkVideo(mp4, 10_000_000, { probe: async () => info(), ffmpeg: fake([11_000_000]).ffmpeg })).rejects.toBeInstanceOf(MediaError);
    const f = fake([1]);
    await expect(shrinkVideo(mp4, 10_000_000, { probe: async () => info({ duration: 7200 }), ffmpeg: f.ffmpeg })).rejects.toThrow('too long');
    expect(f.calls).toHaveLength(0); // no point starting an encode that can only look terrible
  });
  test('a file with no picture, or a text file, is refused before ffmpeg is started', async () => {
    const f = fake([1]);
    await expect(shrinkVideo(mp4, 10_000_000, { probe: async () => info({ hasVideo: false }), ffmpeg: f.ffmpeg })).rejects.toBeInstanceOf(MediaError);
    await expect(shrinkVideo(Buffer.from('#EXTM3U\nhttp://internal/secret'), 10_000_000, { ffmpeg: f.ffmpeg })).rejects.toBeInstanceOf(MediaError);
    expect(f.calls).toHaveLength(0);
  });
});

describe('shrinkVideo (real ffmpeg)', () => {
  real('a noisy 10-second clip well over the limit comes out under it, still an mp4 with sound', async () => {
    const source = await withWorkdir(async dir => {
      await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30:duration=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-vf', 'noise=alls=40:allf=t',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '6000k', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', 'src.mp4'], { cwd: dir, timeoutMs: 60_000 });
      return Bun.file(path.join(dir, 'src.mp4')).bytes().then(b => Buffer.from(b));
    });
    const limit = Math.floor(source.length * 0.5);
    const out = await shrinkVideo(source, limit);
    expect(out.length).toBeLessThanOrEqual(limit); expect(out.length).toBeGreaterThan(1000);
    const p = await withWorkdir(async dir => { await writeFile(path.join(dir, 'o.mp4'), out); return probe(path.join(dir, 'o.mp4'), dir); });
    expect(p.hasVideo).toBe(true); expect(p.hasAudio).toBe(true); expect(p.duration).toBeGreaterThan(9); expect(p.videoCodec).toBe('h264');
  }, 90_000);
});
