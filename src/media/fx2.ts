import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, GlobalFonts, type Image } from '@napi-rs/canvas';
import { ffmpeg, fitEven, GIF_PALETTE, MediaError, probe } from '../framework/media.js';
import { encode, framesOf, pixelsOf, sample, stillOf, toPng, type Pixels } from './anim.js';
import { stripUnsupported, type Job, type Out } from './effects.js';

/** Heist media effects that ffmpeg alone can't do: swirl, globe, magik (seam carving), motivate, speech bubbles, "ah shit". */

const ASSETS = path.resolve(import.meta.dir, '../assets');
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

for (const [file, family] of [['../../assets/fonts/caption.otf', 'BestowCaption'], ['../../assets/fonts/Ubuntu.ttf', 'BestowUbuntu'], ['../../assets/fonts/Circular.ttf', 'BestowRound'], ['../../assets/fonts/bold.ttf', 'BestowBold']] as const) {
  try { GlobalFonts.registerFromPath(path.resolve(import.meta.dir, file), family); } catch { /* optional */ }
}
for (const f of ['/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf']) {
  try { GlobalFonts.registerFromPath(f); } catch { /* not installed */ }
}

/** Per-frame pixel effect over a still or an animation; stills stay PNG unless `togif`. */
async function perFrame(job: Job, fn: (src: Pixels, k: number) => Pixels, o: { togif?: boolean; maxSide?: number; name: string }): Promise<Out> {
  const { frames, fps } = await framesOf(job, { maxSide: o.maxSide ?? 480, maxFrames: 40 });
  const out = frames.map((f, k) => toPng(fn(pixelsOf(f), k)));
  return encode(job.dir, out, fps, frames.length > 1 || o.togif ? 'gif' : 'png', o.name);
}

// ─── Swirl ───────────────────────────────────────────────────────────────────

/** Rotate pixels around the centre, most at the centre and none at the edge. strength −5…5 (1 ≈ a full turn at the middle). */
export function swirlPixels(p: Pixels, strength: number): Pixels {
  const out = new Uint8ClampedArray(p.data.length);
  const cx = p.w / 2, cy = p.h / 2, R = Math.min(cx, cy);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy), o = (y * p.w + x) * 4;
    if (r >= R) { out.set(p.data.subarray(o, o + 4), o); continue; }
    const a = Math.atan2(dy, dx) + strength * 2 * Math.PI * (1 - r / R) ** 2;
    sample(p, cx + r * Math.cos(a), cy + r * Math.sin(a), out, o);
  }
  return { ...p, data: out };
}
export const swirl = (job: Job, strength: number) => perFrame(job, p => swirlPixels(p, clamp(strength, -5, 5)), { name: 'swirl' });

// ─── Globe ───────────────────────────────────────────────────────────────────

/** One frame of the image wrapped round a sphere, turned by `turn` (0–1), lit from the upper left. */
export function globeFrame(src: Pixels, size: number, turn: number): Pixels {
  const data = new Uint8ClampedArray(size * size * 4), R = size / 2 - 2, c = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = (x - c) / R, ny = (y - c) / R, d2 = nx * nx + ny * ny, o = (y * size + x) * 4;
    if (d2 > 1) continue; // transparent outside the globe
    const nz = Math.sqrt(1 - d2);
    const lon = Math.atan2(nx, nz) / (2 * Math.PI) + 0.5 + turn, lat = Math.asin(ny) / Math.PI + 0.5;
    sample(src, ((lon % 1) + 1) % 1 * (src.w - 1), lat * (src.h - 1), data, o);
    const light = 0.35 + 0.75 * Math.max(0, nz * 0.8 - nx * 0.3 - ny * 0.35);
    for (let k = 0; k < 3; k++) data[o + k] = Math.min(255, data[o + k]! * light);
    data[o + 3] = d2 > 0.985 ? 255 * (1 - (d2 - 0.985) / 0.015) : 255; // soft edge
  }
  return { w: size, h: size, data };
}
export async function globe(job: Job): Promise<Out> {
  const src = pixelsOf(await stillOf(job, 600), 600, 300); // equirectangular 2:1
  const frames = Array.from({ length: 36 }, (_, k) => toPng(globeFrame(src, 360, k / 36)));
  return encode(job.dir, frames, 20, 'gif', 'globe');
}

// ─── Magik: seam carving ─────────────────────────────────────────────────────

/** Remove `n` vertical low-energy seams (gradient-magnitude energy, dynamic programming). */
export function carveWidth(p: Pixels, n: number): Pixels {
  let { w, h, data } = p;
  for (let s = 0; s < n && w > 2; s++) {
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) lum[i] = data[i * 4]! * 0.3 + data[i * 4 + 1]! * 0.59 + data[i * 4 + 2]! * 0.11;
    const cost = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const l = lum[y * w + Math.max(0, x - 1)]!, r = lum[y * w + Math.min(w - 1, x + 1)]!, u = lum[Math.max(0, y - 1) * w + x]!, dn = lum[Math.min(h - 1, y + 1) * w + x]!;
      const e = Math.abs(r - l) + Math.abs(dn - u);
      cost[y * w + x] = y === 0 ? e : e + Math.min(cost[(y - 1) * w + Math.max(0, x - 1)]!, cost[(y - 1) * w + x]!, cost[(y - 1) * w + Math.min(w - 1, x + 1)]!);
    }
    const seam = new Int32Array(h);
    let best = 0;
    for (let x = 1; x < w; x++) if (cost[(h - 1) * w + x]! < cost[(h - 1) * w + best]!) best = x;
    seam[h - 1] = best;
    for (let y = h - 2; y >= 0; y--) {
      const x = seam[y + 1]!;
      let b = x;
      for (const cx of [x - 1, x + 1]) if (cx >= 0 && cx < w && cost[y * w + cx]! < cost[y * w + b]!) b = cx;
      seam[y] = b;
    }
    const next = new Uint8ClampedArray((w - 1) * h * 4);
    for (let y = 0; y < h; y++) {
      const cut = seam[y]!;
      next.set(data.subarray(y * w * 4, (y * w + cut) * 4), y * (w - 1) * 4);
      next.set(data.subarray((y * w + cut + 1) * 4, (y + 1) * w * 4), (y * (w - 1) + cut) * 4);
    }
    data = next; w -= 1;
  }
  return { w, h, data };
}
const transpose = (p: Pixels): Pixels => {
  const out = new Uint8ClampedArray(p.data.length);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) out.set(p.data.subarray((y * p.w + x) * 4, (y * p.w + x) * 4 + 4), (x * p.h + y) * 4);
  return { w: p.h, h: p.w, data: out };
};
/** Liquid-rescale down to (1 − amount) in both directions, then stretch back up: the classic "magik" smear. */
export function magikPixels(p: Pixels, amount: number): Pixels {
  const small = transpose(carveWidth(transpose(carveWidth(p, Math.round(p.w * amount))), Math.round(p.h * amount)));
  const c = createCanvas(p.w, p.h), g = c.getContext('2d');
  const sc = createCanvas(small.w, small.h);
  const id = sc.getContext('2d').createImageData(small.w, small.h); id.data.set(small.data); sc.getContext('2d').putImageData(id, 0, 0);
  g.drawImage(sc, 0, 0, p.w, p.h);
  return { w: p.w, h: p.h, data: g.getImageData(0, 0, p.w, p.h).data };
}
export async function magik(job: Job, build: boolean): Promise<Out> {
  if (build && !job.info.animated) {
    const src = pixelsOf(await stillOf(job, 260));
    const frames = Array.from({ length: 12 }, (_, k) => toPng(magikPixels(src, 0.05 + (k / 11) * 0.5)));
    return encode(job.dir, [...frames, ...Array(6).fill(frames.at(-1))], 8, 'gif', 'magik');
  }
  return perFrame(job, p => magikPixels(p, 0.5), { maxSide: job.info.animated ? 200 : 360, name: 'magik' });
}

// ─── Motivate ────────────────────────────────────────────────────────────────

/** A demotivational poster: black card, framed picture, big serif title and a smaller line under it. */
export function motivateFrame(img: Image, title: string, sub: string): Buffer {
  const iw = 520, ih = Math.round((img.height / img.width) * iw), pad = 56;
  const W = iw + pad * 2, titleH = title ? 76 : 0, subH = sub ? 44 : 0, H = pad + ih + 34 + titleH + subH + 34;
  const c = createCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.drawImage(img, pad, pad, iw, ih);
  g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(pad - 8, pad - 8, iw + 16, ih + 16);
  g.fillStyle = '#fff'; g.textAlign = 'center';
  if (title) { g.font = '58px "Liberation Serif", serif'; g.fillText(title.toUpperCase(), W / 2, pad + ih + 34 + 58, W - 40); }
  if (sub) { g.font = '26px "Liberation Serif", serif'; g.fillText(sub, W / 2, pad + ih + 34 + titleH + 30, W - 40); }
  return c.toBuffer('image/png');
}
export async function motivate(job: Job, text: string): Promise<Out> {
  const [title = '', sub = ''] = stripUnsupported(text).split('|').map(s => s.trim());
  if (!title && !sub) throw new MediaError('Give me some `text` — use `|` to split the title and the line under it.');
  const { frames, fps } = await framesOf(job, { maxSide: 520, maxFrames: 40 });
  return encode(job.dir, frames.map(f => motivateFrame(f, title, sub)), fps, frames.length > 1 ? 'gif' : 'png', 'motivate');
}

// ─── Speech bubble ───────────────────────────────────────────────────────────

/**
 * "Heist" style lays the white bubble over the top of the picture; "Flux" cuts the bubble out (transparent) with a thin outline,
 * like the reaction-image meme. Images come out PNG/GIF; videos MP4 or GIF.
 */
export async function speechbubble(job: Job, style: 'heist' | 'flux', o: { togif?: boolean; video?: boolean; output?: 'gif' | 'mp4'; audio?: boolean } = {}): Promise<Out> {
  await copyFile(path.join(ASSETS, 'images/speechbubble.png'), path.join(job.dir, 'bubble.png'));
  await copyFile(path.join(ASSETS, 'images/speech.png'), path.join(job.dir, 'outline.png'));
  const cap = fitEven(job.info.width, job.info.height, o.video ? 1280 : job.info.animated || o.togif ? 480 : 1600);
  const bubbleH = Math.round(cap.h * 0.22) & ~1;
  const graph = style === 'heist'
    ? `[0:v]scale=${cap.w}:${cap.h}[b];[1:v]scale=${cap.w}:${bubbleH}[s];[b][s]overlay=0:0:format=auto`
    : `[0:v]scale=${cap.w}:${cap.h},format=rgba[b];[1:v]scale=${cap.w}:${bubbleH},format=rgba,alphaextract,negate,pad=${cap.w}:${cap.h}:0:0:white[m];[b][m]alphamerge[cut];[2:v]scale=${cap.w}:${bubbleH}[o];[cut][o]overlay=0:0:format=auto`;
  const inputs = ['-i', job.input, '-loop', '1', '-i', 'bubble.png', '-loop', '1', '-i', 'outline.png'];
  const animated = job.info.animated || !!o.video;
  if (o.video && o.output !== 'gif') {
    const keep = o.audio !== false && job.info.hasAudio;
    await ffmpeg(['-t', '30', ...inputs, '-filter_complex', `${graph},format=yuv420p[v]`, '-map', '[v]', ...(keep ? ['-map', '0:a?', '-c:a', 'aac'] : ['-an']), '-shortest', '-c:v', 'libx264', '-crf', '26', '-preset', 'veryfast', '-movflags', '+faststart', 'out.mp4'], { cwd: job.dir });
    return { file: 'out.mp4', name: 'speechbubble.mp4' };
  }
  if (animated || o.togif) {
    await ffmpeg(['-t', animated ? '15' : '1', ...(animated ? [] : ['-loop', '1']), ...inputs, '-filter_complex', `${graph},${GIF_PALETTE}`, '-shortest', '-loop', '0', ...(animated ? [] : ['-frames:v', '1']), 'out.gif'], { cwd: job.dir });
    return { file: 'out.gif', name: 'speechbubble.gif' };
  }
  await ffmpeg([...inputs, '-filter_complex', graph, '-frames:v', '1', 'out.png'], { cwd: job.dir });
  return { file: 'out.png', name: 'speechbubble.png' };
}

// ─── Ah shit, here we go again ───────────────────────────────────────────────

/** Heist's template: CJ walking in on a green screen, the line subtitled, with the audio (1280×720, ~3 s). */
export const AHSHIT_CLIP = path.join(ASSETS, 'videos/ahshit.mp4');

/**
 * The GTA San Andreas "Ah shit, here we go again" clip with CJ keyed over the picture (or GIF/video, looped), full-bleed at
 * 16:9 like the template. With no picture it's the template itself, green screen and audio as-is — which is what Heist sends.
 */
export async function ahshit(job: Job | null, dir = job?.dir): Promise<Out> {
  if (!dir) throw new MediaError('Nothing to work in.');
  if (!job) {
    await copyFile(AHSHIT_CLIP, path.join(dir, 'out.mp4'));
    return { file: 'out.mp4', name: 'ahshit.mp4' };
  }
  const bg = job.info.animated ? ['-stream_loop', '-1', '-i', job.input] : ['-loop', '1', '-framerate', '25', '-i', job.input];
  const graph = '[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,fps=25[bg];'
    + '[1:v]chromakey=0x00FE22:0.15:0.06,despill=type=green[fg];[bg][fg]overlay=shortest=1:format=auto,format=yuv420p[v]';
  await ffmpeg([...bg, '-i', AHSHIT_CLIP, '-filter_complex', graph, '-map', '[v]', '-map', '1:a', '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'out.mp4'], { cwd: dir, timeoutMs: 120_000 }); // overlay stops at the clip's end
  return { file: 'out.mp4', name: 'ahshit.mp4' };
}

// ─── Image + audio with Heist's options ──────────────────────────────────────

export const ADD_AUDIO_EFFECTS = ['Blurred to Clear', 'Clear to Blurred', 'Pixelized to Clear', 'Clear to Pixelized', 'Fade In', 'Fade Out', 'Wipe Left to Right', 'Slide Up'] as const;

/** The video graph for an effect: most use xfade between two versions of the picture over the first/last `t` seconds. */
export function addAudioGraph(effect: string | null, w: number, h: number, dur: number): string {
  const t = Math.min(2.5, Math.max(0.5, dur / 3)), end = Math.max(0, dur - t);
  const base = `[0:v]scale=${w}:${h},setsar=1,format=yuv420p,fps=25`;
  const blurred = `boxblur=${Math.max(4, Math.round(w / 40))}:2`;
  const pixel = `scale=${Math.max(4, Math.round(w / 32))}:-2:flags=neighbor,scale=${w}:${h}:flags=neighbor,setsar=1`;
  const split = (a: string, b: string, trans: string, offset: number, from: 'a' | 'b') =>
    `${base},split[p][q];[p]${a},trim=duration=${offset + t}[x];[q]${b},trim=duration=${dur}[y];${from === 'a' ? '[x][y]' : '[y][x]'}xfade=transition=${trans}:duration=${t}:offset=${offset}[v]`;
  switch (effect) {
    case 'Blurred to Clear': return split(blurred, 'null', 'fade', 0, 'a');
    case 'Clear to Blurred': return split('null', blurred, 'fade', end, 'a');
    case 'Pixelized to Clear': return split(pixel, 'null', 'fade', 0, 'a');
    case 'Clear to Pixelized': return split('null', pixel, 'fade', end, 'a');
    case 'Fade In': return `${base},fade=t=in:st=0:d=${t}[v]`;
    case 'Fade Out': return `${base},fade=t=out:st=${end}:d=${t}[v]`;
    case 'Wipe Left to Right': return split('drawbox=c=black:t=fill', 'null', 'wiperight', 0, 'a');
    case 'Slide Up': return split('drawbox=c=black:t=fill', 'null', 'slideup', 0, 'a');
    default: return `${base}[v]`;
  }
}

export async function imageWithAudio2(dir: string, image: string, audio: string, o: { loop: number; volume: number; start: number; end: number; effect: string | null }): Promise<Out> {
  const info = await probe(image, dir), a = await probe(audio, dir);
  const cap = fitEven(info.width, info.height, 1280);
  const clipStart = Math.max(0, o.start), clipEnd = o.end > clipStart ? Math.min(o.end, a.duration || o.end) : (a.duration || 60);
  const one = Math.max(0.5, clipEnd - clipStart), loops = clamp(Math.round(o.loop), 1, 5);
  const dur = Math.min(300, one * loops);
  await ffmpeg(['-ss', String(clipStart), '-t', String(one), '-i', audio, '-af', `volume=${clamp(o.volume, 0.1, 2)}`, '-vn', 'clip.m4a'], { cwd: dir });
  const graph = addAudioGraph(o.effect, cap.w, cap.h, dur);
  await ffmpeg(['-loop', '1', '-framerate', '25', '-t', String(dur), '-i', image, '-stream_loop', String(loops - 1), '-i', 'clip.m4a',
    '-filter_complex', graph, '-map', '[v]', '-map', '1:a', '-t', String(dur), '-c:v', 'libx264', '-tune', 'stillimage', '-crf', '28', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'out.mp4'], { cwd: dir, timeoutMs: 180_000 });
  return { file: 'out.mp4', name: 'result.mp4' };
}
