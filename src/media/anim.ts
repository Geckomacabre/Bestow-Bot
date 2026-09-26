import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, type Canvas, type Image } from '@napi-rs/canvas';
import { ffmpeg, fitEven, GIF_PALETTE, MediaError } from '../framework/media.js';
import { safeLoadImage } from '../framework/imgsafe.js';
import type { Job, Out } from './effects.js';

/**
 * Frame-by-frame effects drawn in JS (canvas + raw pixels), for things ffmpeg filters can't express: sphere mapping, swirls,
 * and seam carving. Frames go in and out through ffmpeg, so any image/GIF/video input works.
 */

/** The first frame of the input as a decoded image, at most `maxSide` px. */
export async function stillOf(job: Job, maxSide = 800): Promise<Image> {
  const { w, h } = fitEven(job.info.width || maxSide, job.info.height || maxSide, maxSide);
  await ffmpeg(['-i', job.input, '-vf', `scale=${w}:${h}`, '-frames:v', '1', 'still.png'], { cwd: job.dir });
  return safeLoadImage(await readFile(path.join(job.dir, 'still.png')));
}

/** All frames of an animated input (≤ maxFrames at ≤ fps), or the single still. */
export async function framesOf(job: Job, o: { maxSide?: number; maxFrames?: number; fps?: number } = {}): Promise<{ frames: Image[]; fps: number }> {
  const maxSide = o.maxSide ?? 480, maxFrames = o.maxFrames ?? 48;
  if (!job.info.animated) return { frames: [await stillOf(job, maxSide)], fps: 1 };
  const fps = Math.min(o.fps ?? 15, job.info.fps > 0 ? job.info.fps : 15);
  const { w, h } = fitEven(job.info.width, job.info.height, maxSide);
  await ffmpeg(['-t', String(maxFrames / fps), '-i', job.input, '-vf', `fps=${fps},scale=${w}:${h}`, '-frames:v', String(maxFrames), 'fr_%03d.png'], { cwd: job.dir });
  const names = (await readdir(job.dir)).filter(n => /^fr_\d+\.png$/.test(n)).sort();
  if (!names.length) throw new MediaError('I couldn\'t read any frames from that.');
  return { frames: await Promise.all(names.map(async n => safeLoadImage(await readFile(path.join(job.dir, n))))), fps };
}

export type Format = 'gif' | 'mp4' | 'png';

/** Encode PNG frames (in order) to a looping GIF, an MP4, or — for a single frame — a PNG. */
export async function encode(dir: string, frames: Buffer[], fps: number, format: Format, base = 'result'): Promise<Out> {
  if (format === 'png') {
    await writeFile(path.join(dir, 'out.png'), frames[0]!);
    return { file: 'out.png', name: `${base}.png` };
  }
  await Promise.all(frames.map((f, n) => writeFile(path.join(dir, `enc_${String(n).padStart(4, '0')}.png`), f)));
  if (format === 'mp4') {
    await ffmpeg(['-framerate', String(fps), '-i', 'enc_%04d.png', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-crf', '24', '-preset', 'veryfast', '-movflags', '+faststart', 'out.mp4'], { cwd: dir, timeoutMs: 120_000 });
    return { file: 'out.mp4', name: `${base}.mp4` };
  }
  await ffmpeg(['-framerate', String(fps), '-i', 'enc_%04d.png', '-vf', GIF_PALETTE, '-loop', '0', 'out.gif'], { cwd: dir, timeoutMs: 120_000 });
  return { file: 'out.gif', name: `${base}.gif` };
}

// ─── Pixels ──────────────────────────────────────────────────────────────────

export interface Pixels { w: number; h: number; data: Uint8ClampedArray }

export function pixelsOf(img: Image | Canvas, w = img.width, h = img.height): Pixels {
  const c = createCanvas(w, h), g = c.getContext('2d');
  g.drawImage(img as Image, 0, 0, w, h);
  return { w, h, data: g.getImageData(0, 0, w, h).data };
}

export function toPng(p: Pixels): Buffer {
  const c = createCanvas(p.w, p.h), g = c.getContext('2d');
  const id = g.createImageData(p.w, p.h);
  id.data.set(p.data);
  g.putImageData(id, 0, 0);
  return c.toBuffer('image/png');
}

/** Bilinear sample (clamped to the edges) into out[o..o+3]. */
export function sample(p: Pixels, x: number, y: number, out: Uint8ClampedArray, o: number) {
  const fx = Math.max(0, Math.min(p.w - 1, x)), fy = Math.max(0, Math.min(p.h - 1, y));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(p.w - 1, x0 + 1), y1 = Math.min(p.h - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
  const i00 = (y0 * p.w + x0) * 4, i10 = (y0 * p.w + x1) * 4, i01 = (y1 * p.w + x0) * 4, i11 = (y1 * p.w + x1) * 4, d = p.data;
  for (let k = 0; k < 4; k++) {
    out[o + k] = (d[i00 + k]! * (1 - ax) + d[i10 + k]! * ax) * (1 - ay) + (d[i01 + k]! * (1 - ax) + d[i11 + k]! * ax) * ay;
  }
}
