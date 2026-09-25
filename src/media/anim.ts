import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, type Canvas, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { ffmpeg, fitEven, GIF_PALETTE, MediaError } from '../framework/media.js';
import { safeLoadImage } from '../framework/imgsafe.js';
import type { Job, Out } from './effects.js';

/**
 * Frame-by-frame effects drawn in JS (canvas + raw pixels), for things ffmpeg filters can't express: sphere mapping, swirls,
 * seam carving and the 3D "makesweet" scenes. Frames go in and out through ffmpeg, so any image/GIF/video input works.
 */

export type Pt = [number, number];

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

/** Render `n` frames of size w×h with `draw(g, t)` where t goes 0 → 1 (exclusive) — a seamless loop. */
export function renderLoop(n: number, w: number, h: number, draw: (g: SKRSContext2D, t: number, k: number, c: Canvas) => void): Buffer[] {
  const out: Buffer[] = [];
  for (let k = 0; k < n; k++) {
    const c = createCanvas(w, h), g = c.getContext('2d');
    draw(g, k / n, k, c);
    out.push(c.toBuffer('image/png'));
  }
  return out;
}

// ─── Geometry ────────────────────────────────────────────────────────────────

/** Homography mapping the unit square (0,0)(1,0)(1,1)(0,1) onto the quad q0..q3. */
export function squareToQuad(q: [Pt, Pt, Pt, Pt]): (u: number, v: number) => Pt {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a: number, b: number, c: number, d: number, e: number, f: number, gg: number, h: number;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = x1 - x0; b = x2 - x1; c = x0; d = y1 - y0; e = y2 - y1; f = y0; gg = 0; h = 0;
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    gg = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + gg * x1; b = x3 - x0 + h * x3; c = x0; d = y1 - y0 + gg * y1; e = y3 - y0 + h * y3; f = y0;
  }
  return (u, v) => { const w = gg * u + h * v + 1; return [(a * u + b * v + c) / w, (d * u + e * v + f) / w]; };
}

function drawTriangle(g: SKRSContext2D, img: Image | Canvas, s: [Pt, Pt, Pt], d: [Pt, Pt, Pt]) {
  const [[u0, v0], [u1, v1], [u2, v2]] = s, [[x0, y0], [x1, y1], [x2, y2]] = d;
  const den = u0 * (v2 - v1) - u1 * v2 + u2 * v1 + (u1 - u2) * v0;
  if (Math.abs(den) < 1e-9) return;
  const m11 = -(v0 * (x2 - x1) - v1 * x2 + v2 * x1 + (v1 - v2) * x0) / den;
  const m12 = (v1 * y2 + v0 * (y1 - y2) - v2 * y1 + (v2 - v1) * y0) / den;
  const m21 = (u0 * (x2 - x1) - u1 * x2 + u2 * x1 + (u1 - u2) * x0) / den;
  const m22 = -(u1 * y2 + u0 * (y1 - y2) - u2 * y1 + (u2 - u1) * y0) / den;
  const dx = (u0 * (v2 * x1 - v1 * x2) + v0 * (u1 * x2 - u2 * x1) + (u2 * v1 - u1 * v2) * x0) / den;
  const dy = (u0 * (v2 * y1 - v1 * y2) + v0 * (u1 * y2 - u2 * y1) + (u2 * v1 - u1 * v2) * y0) / den;
  g.save();
  // Grow the clip a hair so neighbouring triangles don't leave hairline seams.
  const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3, grow = (x: number, y: number): Pt => { const k = 1 + 0.9 / Math.max(1, Math.hypot(x - cx, y - cy)); return [cx + (x - cx) * k, cy + (y - cy) * k]; };
  const [a, b, c] = [grow(x0, y0), grow(x1, y1), grow(x2, y2)];
  g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.closePath(); g.clip();
  g.transform(m11, m12, m21, m22, dx, dy);
  // Only draw the part of the texture this triangle uses — drawing the whole texture under the clip is ~20× slower.
  const bx = Math.max(0, Math.floor(Math.min(u0, u1, u2)) - 1), by = Math.max(0, Math.floor(Math.min(v0, v1, v2)) - 1);
  const bw = Math.min(img.width, Math.ceil(Math.max(u0, u1, u2)) + 1) - bx, bh = Math.min(img.height, Math.ceil(Math.max(v0, v1, v2)) + 1) - by;
  if (bw > 0 && bh > 0) g.drawImage(img as Image, bx, by, bw, bh, bx, by, bw, bh);
  g.restore();
}

/**
 * Draw the source rectangle `src` of `img` onto a (possibly perspective) quad, perspective-correct by subdividing it into a grid of
 * affine triangles. Quad corners go top-left, top-right, bottom-right, bottom-left.
 */
export function drawQuad(g: SKRSContext2D, img: Image | Canvas, quad: [Pt, Pt, Pt, Pt], o: { src?: [number, number, number, number]; steps?: number } = {}) {
  const [sx, sy, sw, sh] = o.src ?? [0, 0, img.width, img.height];
  const n = o.steps ?? 8, H = squareToQuad(quad);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const u0 = i / n, u1 = (i + 1) / n, v0 = j / n, v1 = (j + 1) / n;
    const s = (u: number, v: number): Pt => [sx + u * sw, sy + v * sh];
    const p00 = H(u0, v0), p10 = H(u1, v0), p11 = H(u1, v1), p01 = H(u0, v1);
    drawTriangle(g, img, [s(u0, v0), s(u1, v0), s(u1, v1)], [p00, p10, p11]);
    drawTriangle(g, img, [s(u0, v0), s(u1, v1), s(u0, v1)], [p00, p11, p01]);
  }
}

export type V3 = [number, number, number];
export const rotY = ([x, y, z]: V3, a: number): V3 => [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
export const rotX = ([x, y, z]: V3, a: number): V3 => [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
/** Perspective projection: camera at z = -dist looking down +z, centred on (cx, cy). */
export const project = ([x, y, z]: V3, cx: number, cy: number, focal: number, dist: number): Pt => [cx + (x * focal) / (z + dist), cy + (y * focal) / (z + dist)];

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
