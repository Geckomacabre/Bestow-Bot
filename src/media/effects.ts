import { existsSync } from 'node:fs';
import { copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GIF_PALETTE, MediaError, fitEven, ffmpeg, probe, type Probe } from '../framework/media.js';

/**
 * ffmpeg recipes. Every function takes a Job (workdir + probed input) and returns the name of a file it
 * wrote in that workdir. User text is only ever passed through text files (never spliced into a
 * filter string), and every output is size/time-capped.
 */

export interface Job { dir: string; input: string; info: Probe }
export interface Out { file: string; name: string }

const FONT_SRC = path.resolve(import.meta.dir, '../../assets/fonts/caption.otf');
const MAX_STILL = 1600;
const MAX_GIF = 480;
const MAX_VIDEO = 1280;
const MAX_SECONDS = 30;

export const stripUnsupported = (t: string) => t.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️]/gu, '').replace(/\s+\n/g, '\n').trim();

export async function makeJob(dir: string, input: string): Promise<Job> {
  const info = await probe(input, dir);
  if (!info.hasVideo && !info.hasAudio) throw new MediaError('That file has no image, video or audio I can use.');
  return { dir, input, info };
}

/** Greedy word wrap on a character budget. */
export function wrapText(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if ((line + ' ' + word).length <= maxChars) line += ' ' + word;
      else { out.push(line); line = word; }
      while (line.length > maxChars) { out.push(line.slice(0, maxChars)); line = line.slice(maxChars); }
    }
    out.push(line);
  }
  return out.filter((l, i) => l || i < out.length - 1);
}

async function prepFont(job: Job): Promise<string> {
  await copyFile(FONT_SRC, path.join(job.dir, 'font.otf'));
  return 'font.otf';
}

async function textFile(job: Job, name: string, text: string): Promise<string> {
  await writeFile(path.join(job.dir, name), text, 'utf8');
  return name;
}

// ─── Stills / GIFs ───────────────────────────────────────────────────────────

/** Run an -vf chain over an image or GIF; stills come out as PNG (or JPG), animations as GIF. */
export async function imageFilter(job: Job, vf: string, opts: { jpg?: boolean; forceGif?: boolean; name?: string } = {}): Promise<Out> {
  const { info } = job;
  const animated = info.animated || opts.forceGif;
  const cap = animated ? MAX_GIF : MAX_STILL;
  const pre = Math.max(info.width, info.height) > cap ? `scale=${fitEven(info.width, info.height, cap).w}:${fitEven(info.width, info.height, cap).h},` : '';
  if (animated) {
    const out = 'out.gif';
    await ffmpeg(['-t', String(MAX_SECONDS), '-i', job.input, '-vf', `${pre}${vf},${GIF_PALETTE}`, '-loop', '0', out], { cwd: job.dir });
    return { file: out, name: opts.name ?? 'result.gif' };
  }
  const out = opts.jpg ? 'out.jpg' : 'out.png';
  await ffmpeg(['-i', job.input, '-vf', `${pre}${vf}`, '-frames:v', '1', ...(opts.jpg ? ['-q:v', '28'] : []), out], { cwd: job.dir });
  return { file: out, name: opts.name ?? `result.${opts.jpg ? 'jpg' : 'png'}` };
}

/** `togif`: a still comes out as a (one-frame) GIF instead of a PNG — handy for saving as a Discord favourite. */
export interface StillOpts { togif?: boolean }

export const blur = (job: Job, strength: number) => imageFilter(job, `gblur=sigma=${clamp(strength, 0.1, 40)}:steps=2`);
export const invert = (job: Job, o: StillOpts = {}) => imageFilter(job, 'negate', { forceGif: o.togif });
export const grayscale = (job: Job, o: StillOpts = {}) => imageFilter(job, 'hue=s=0', { forceGif: o.togif });
export const flip = (job: Job, dir: 'horizontal' | 'vertical' | 'both', o: StillOpts = {}) => imageFilter(job, dir === 'horizontal' ? 'hflip' : dir === 'vertical' ? 'vflip' : 'hflip,vflip', { forceGif: o.togif });

/** Blocky pixels `size` px across (in the input's own pixels). */
export function pixelate(job: Job, size: number, o: StillOpts = {}) {
  const { width: w, height: h } = job.info;
  const s = clamp(size, 2, 512);
  return imageFilter(job, `scale=${Math.max(1, Math.round(w / s))}:${Math.max(1, Math.round(h / s))}:flags=neighbor,scale=${w}:${h}:flags=neighbor`, { forceGif: o.togif });
}
/** Heist's pixelate sizes: how many blocks fit across the longest side. */
export const PIXELATE_BLOCKS = { Small: 96, Medium: 48, Large: 24 } as const;
export const pixelSize = (w: number, h: number, size: keyof typeof PIXELATE_BLOCKS) => Math.max(2, Math.round(Math.max(w, h) / PIXELATE_BLOCKS[size]));

export function rotate(job: Job, degrees: number) {
  const d = ((Math.round(degrees) % 360) + 360) % 360;
  if (d === 0) return imageFilter(job, 'null');
  if (d === 90) return imageFilter(job, 'transpose=1');
  if (d === 180) return imageFilter(job, 'hflip,vflip');
  if (d === 270) return imageFilter(job, 'transpose=2');
  return imageFilter(job, `format=rgba,rotate=${d}*PI/180:ow=rotw(${d}*PI/180):oh=roth(${d}*PI/180):c=black@0`);
}

/** Barrel-distortion bulge: distort, then crop away the empty corners and scale back to full size. */
export function fisheye(job: Job) {
  const { w, h } = fitEven(job.info.width, job.info.height, job.info.animated ? MAX_GIF : MAX_STILL);
  return imageFilter(job, `scale=${w}:${h},lenscorrection=cx=0.5:cy=0.5:k1=0.75:k2=0.05,crop=trunc(iw*0.7/2)*2:trunc(ih*0.7/2)*2,scale=${w}:${h}`);
}

/**
 * Radial zoom blur: average several progressively zoomed copies. Heist's power runs −10…10; in a still, zooming in or out
 * streaks the same way, so the sign doesn't change the look and 0 leaves the picture as it is.
 */
export function zoomBlur(job: Job, power: number) {
  const p = clamp(Math.abs(power), 0, 10);
  if (p === 0) return imageFilter(job, 'null');
  // mix needs identical frame sizes, so work in exact integer dimensions rather than iw/z arithmetic.
  const { w, h } = fitEven(job.info.width, job.info.height, job.info.animated ? MAX_GIF : MAX_STILL);
  const steps = [1, 2, 3, 4, 5, 6].map(x => 1 + x * 0.006 * p);
  const even = (n: number) => Math.ceil(n / 2) * 2;
  const branches = steps.map((z, i) => `[c${i}]scale=${even(w * z)}:${even(h * z)},crop=${w}:${h}[z${i}]`).join(';');
  return imageFilter(job, `scale=${w}:${h},split=7[o][c0][c1][c2][c3][c4][c5];${branches};[o][z0][z1][z2][z3][z4][z5]mix=inputs=7:duration=first`);
}

/** Over-saturated, crunchy, re-compressed. */
export const deepfry = (job: Job) => imageFilter(job, 'eq=contrast=2.1:saturation=3.2:brightness=0.05,noise=alls=22:allf=t+u,unsharp=7:7:2.5,eq=gamma=1.15', { jpg: true });

/** A still that spins in place, as a looping GIF. */
export async function spin(job: Job): Promise<Out> {
  const size = Math.min(Math.min(job.info.width, job.info.height), 360) & ~1;
  const out = 'out.gif';
  const vf = `crop=min(iw\\,ih):min(iw\\,ih),scale=${size}:${size},format=rgba,rotate=2*PI*t/2:ow=iw:oh=ih:c=black@0,${GIF_PALETTE}`;
  await ffmpeg(['-loop', '1', '-framerate', '25', '-t', '2', '-i', job.input, '-vf', vf, '-loop', '0', out], { cwd: job.dir });
  return { file: out, name: 'spin.gif' };
}

/** Forward then backward, looping. */
export async function pingpong(job: Job): Promise<Out> {
  if (!job.info.animated) throw new MediaError('Pingpong needs a GIF or video (something with motion).');
  if (job.info.duration > 12) throw new MediaError('That\'s too long for pingpong — use something under 12 seconds.');
  const cap = fitEven(job.info.width, job.info.height, MAX_GIF);
  const out = 'out.gif';
  await ffmpeg(['-t', '12', '-i', job.input, '-vf', `fps=15,scale=${cap.w}:${cap.h},split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0,${GIF_PALETTE}`, '-loop', '0', out], { cwd: job.dir });
  return { file: out, name: 'pingpong.gif' };
}

export async function toGif(job: Job): Promise<Out> {
  const cap = fitEven(job.info.width, job.info.height, MAX_GIF);
  const out = 'out.gif';
  const fps = job.info.animated ? 'fps=15,' : '';
  await ffmpeg(['-t', String(MAX_SECONDS), '-i', job.input, '-vf', `${fps}scale=${cap.w}:${cap.h}:flags=lanczos,${GIF_PALETTE}`, '-loop', '0', out], { cwd: job.dir });
  return { file: out, name: 'result.gif' };
}

// ─── Text on media ───────────────────────────────────────────────────────────

/**
 * One drawtext per line, each centred on its own. (drawtext's text_align only exists in newer ffmpeg builds,
 * and centring the whole block would left-align the lines inside it.)
 */
async function centeredLines(job: Job, prefix: string, lines: string[], o: { font: string; fontSize: number; color: string; border?: string; borderW?: number; lineHeight: number; y: (i: number) => string }): Promise<string[]> {
  const parts: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const tf = await textFile(job, `${prefix}${i}.txt`, lines[i]!);
    parts.push(`drawtext=fontfile=${o.font}:textfile=${tf}:fontcolor=${o.color}:fontsize=${o.fontSize}${o.border ? `:bordercolor=${o.border}:borderw=${o.borderW ?? 2}` : ''}:x=(w-text_w)/2:y=${o.y(i)}`);
  }
  return parts;
}

const workWidth = (job: Job, video: boolean) => fitEven(job.info.width, job.info.height, video ? MAX_VIDEO : job.info.animated ? MAX_GIF : MAX_STILL).w;

export interface CaptionOpts extends StillOpts, VideoOpts {
  /** A second caption in a bar under the media (Heist's `caption_bottom`). */
  bottomText?: string;
  /** Put the (only) caption under the media instead of above it (Heist's video `bottom`). */
  bottom?: boolean;
  video?: boolean;
}

/** White bar with black text above (and/or below) the media — the classic "caption" look. */
export async function caption(job: Job, rawText: string, o: CaptionOpts = {}): Promise<Out> {
  const main = stripUnsupported(rawText), extra = stripUnsupported(o.bottomText ?? '');
  const topText = o.bottom ? '' : main, bottomText = o.bottom ? main : extra;
  if (!topText && !bottomText) throw new MediaError('There\'s no text left to draw (emoji aren\'t supported in captions).');
  const w = workWidth(job, !!o.video);
  const fontSize = Math.max(16, Math.round(w / 13));
  const wrap = (t: string) => (t ? wrapText(t, Math.max(8, Math.floor(w / (fontSize * 0.52)))) : []);
  const topLines = wrap(topText), bottomLines = wrap(bottomText);
  const lh = Math.round(fontSize * 1.22);
  const pad = Math.round(fontSize * 0.5);
  const barOf = (n: number) => (n ? (n * lh + pad * 2) & ~1 : 0);
  const topBar = barOf(topLines.length), bottomBar = barOf(bottomLines.length);
  const font = await prepFont(job);
  const style = { font, fontSize, color: 'black', lineHeight: lh };
  const draws = [
    ...await centeredLines(job, 'cap', topLines, { ...style, y: i => String(pad + i * lh) }),
    ...await centeredLines(job, 'capb', bottomLines, { ...style, y: i => `h-${bottomBar}+${pad + i * lh}` }),
  ];
  const vf = `pad=iw:ih+${topBar + bottomBar}:0:${topBar}:color=white,${draws.join(',')}`;
  return o.video ? videoFilter(job, vf, { audio: o.audio }) : imageFilter(job, vf, { forceGif: o.togif });
}

/** Impact-style top/bottom text with a black outline. */
export async function meme(job: Job, topRaw: string, bottomRaw: string): Promise<Out> {
  const top = stripUnsupported(topRaw).toUpperCase(), bottom = stripUnsupported(bottomRaw).toUpperCase();
  if (!top && !bottom) throw new MediaError('Give me some text: `top` and/or `bottom`.');
  const w = workWidth(job, false);
  const fontSize = Math.max(18, Math.round(w / 9));
  const lh = Math.round(fontSize * 1.05);
  const maxChars = Math.max(6, Math.floor(w / (fontSize * 0.5)));
  const font = await prepFont(job);
  const style = { font, fontSize, color: 'white', border: 'black', borderW: Math.max(2, Math.round(fontSize / 12)), lineHeight: lh };
  const parts: string[] = [];
  if (top) { const l = wrapText(top, maxChars); parts.push(...await centeredLines(job, 'top', l, { ...style, y: i => String(12 + i * lh) })); }
  if (bottom) { const l = wrapText(bottom, maxChars); parts.push(...await centeredLines(job, 'bot', l, { ...style, y: i => `h-${(l.length - i) * lh + 14}` })); }
  return imageFilter(job, parts.join(','));
}

export type Position = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';
export const POSITIONS: Position[] = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
const POS_XY: Record<Position, string> = {
  'top-left': 'x=24:y=24', top: 'x=(w-text_w)/2:y=24', 'top-right': 'x=w-text_w-24:y=24',
  left: 'x=24:y=(h-text_h)/2', center: 'x=(w-text_w)/2:y=(h-text_h)/2', right: 'x=w-text_w-24:y=(h-text_h)/2',
  'bottom-left': 'x=24:y=h-text_h-24', bottom: 'x=(w-text_w)/2:y=h-text_h-24', 'bottom-right': 'x=w-text_w-24:y=h-text_h-24',
};

/** Heist's watermark fonts → the closest face available here (first file that exists wins). */
const WM_FONTS: Record<string, string[]> = {
  'Impact': ['/usr/share/fonts/truetype/liberation/LiberationSansNarrow-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf', FONT_SRC],
  'Futura Black': [FONT_SRC], // caption.otf is Futura Extra Black Condensed
  'Quicksand Bold': [path.resolve(import.meta.dir, '../../assets/fonts/bold.ttf')], // a rounded bold, like Quicksand
  'Ubuntu Bold': [path.resolve(import.meta.dir, '../../assets/fonts/Ubuntu.ttf')],
  'Liberation Sans Bold': ['/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', path.resolve(import.meta.dir, '../../assets/fonts/caption2.ttf')],
};
export const WATERMARK_FONTS = Object.keys(WM_FONTS);
export const WATERMARK_COLORS: Record<string, string> = { White: '#ffffff', Black: '#000000', Red: '#e53935', Yellow: '#ffd600', Orange: '#ff9100', Blue: '#2979ff' };

export interface WatermarkOpts extends VideoOpts {
  position: Position;
  /** 0.1–1 */
  opacity: number;
  /** Font size in px; unset = about 1/18 of the width. */
  size?: number | null;
  /** #rrggbb */
  color: string;
  /** One of WATERMARK_FONTS (default Impact). */
  font?: string;
}

export async function watermark(job: Job, rawText: string, opts: WatermarkOpts, video = false): Promise<Out> {
  const text = stripUnsupported(rawText);
  if (!text) throw new MediaError('There\'s no text left to draw (emoji aren\'t supported in watermarks).');
  const src = (WM_FONTS[opts.font ?? 'Impact'] ?? WM_FONTS.Impact!).find(f => existsSync(f)) ?? FONT_SRC;
  const font = `wmfont${path.extname(src)}`;
  await copyFile(src, path.join(job.dir, font));
  const tf = await textFile(job, 'wm.txt', text.slice(0, 120));
  const width = fitEven(job.info.width, job.info.height, video ? MAX_VIDEO : job.info.animated ? MAX_GIF : MAX_STILL).w;
  const fontSize = Math.round(clamp(opts.size ?? width / 18, 8, 400));
  const color = /^#?[0-9a-f]{6}$/i.test(opts.color) ? opts.color.replace('#', '0x') : '0x000000';
  const a = clamp(opts.opacity, 0.1, 1);
  // A thin outline in the opposite tone keeps it readable on any background.
  const outline = /^0x0{6}$/i.test(color) ? 'white' : 'black';
  const vf = `drawtext=fontfile=${font}:textfile=${tf}:fontcolor=${color}@${a}:fontsize=${fontSize}:borderw=${Math.max(1, Math.round(fontSize / 28))}:bordercolor=${outline}@${(a * 0.5).toFixed(2)}:${POS_XY[opts.position]}`;
  return video ? videoFilter(job, vf, { audio: opts.audio }) : imageFilter(job, vf);
}

/**
 * Put one image on another, Heist-style: `x`/`y` are pixel offsets from the base's top-left, `scale` multiplies the overlay's own
 * size (0.1–5) and `opacity` is 0–1. Offsets and size are in the base's original pixels, so they still line up after the base is
 * scaled down to the output cap.
 */
export async function overlay(base: Job, overlayFile: string, opts: { opacity: number; x: number; y: number; scale: number }): Promise<Out> {
  const { info } = base;
  const animated = info.animated;
  const cap = animated ? MAX_GIF : MAX_STILL;
  const fit = fitEven(info.width, info.height, cap);
  const k = fit.w / Math.max(1, info.width); // base downscale factor
  const over = await probe(overlayFile, base.dir);
  const ow = Math.max(2, Math.round((over.width * clamp(opts.scale, 0.1, 5) * k) / 2) * 2);
  const x = Math.round(Math.max(0, opts.x) * k), y = Math.round(Math.max(0, opts.y) * k);
  const graph = `[0:v]scale=${fit.w}:${fit.h}[b];[1:v]scale=${ow}:-2,format=rgba,colorchannelmixer=aa=${clamp(opts.opacity, 0, 1)}[o];[b][o]overlay=x=${x}:y=${y}:format=auto`;
  if (animated) {
    await ffmpeg(['-t', String(MAX_SECONDS), '-i', base.input, '-i', overlayFile, '-filter_complex', `${graph},${GIF_PALETTE}`, '-loop', '0', 'out.gif'], { cwd: base.dir });
    return { file: 'out.gif', name: 'overlay.gif' };
  }
  await ffmpeg(['-i', base.input, '-i', overlayFile, '-filter_complex', graph, '-frames:v', '1', 'out.png'], { cwd: base.dir });
  return { file: 'out.png', name: 'overlay.png' };
}

// ─── Video ───────────────────────────────────────────────────────────────────

/** Heist's video options: `audio: false` drops the sound (default: keep it). */
export interface VideoOpts { audio?: boolean }

/** Video output: H.264 + AAC, ≤1280px, ≤30s, even dimensions, streamable. */
export async function videoFilter(job: Job, vf: string, opts: { af?: string; name?: string; extraIn?: string[] } & VideoOpts = {}): Promise<Out> {
  if (!job.info.hasVideo) throw new MediaError('That needs a video or GIF.');
  const cap = fitEven(job.info.width, job.info.height, MAX_VIDEO);
  const scaleCap = Math.max(job.info.width, job.info.height) > MAX_VIDEO ? `scale=${cap.w}:${cap.h},` : '';
  const out = 'out.mp4';
  const sound = job.info.hasAudio && opts.audio !== false;
  const args = [
    '-t', String(MAX_SECONDS), ...(opts.extraIn ?? []), '-i', job.input,
    '-vf', `${scaleCap}${vf},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
    ...(sound ? (opts.af ? ['-af', opts.af] : []) : ['-an']),
    '-c:v', 'libx264', '-crf', '27', '-preset', 'veryfast', '-movflags', '+faststart',
    ...(sound ? ['-c:a', 'aac', '-b:a', '96k'] : []),
    out,
  ];
  await ffmpeg(args, { cwd: job.dir });
  return { file: out, name: opts.name ?? 'result.mp4' };
}

export const videoReverse = (job: Job, o: VideoOpts = {}) => videoFilter(job, 'reverse', { af: 'areverse', name: 'reversed.mp4', ...o });
export const videoScramble = (job: Job, o: VideoOpts = {}) => videoFilter(job, 'random=frames=24', { name: 'scrambled.mp4', ...o });

export function videoRotate(job: Job, degrees: number, o: VideoOpts = {}) {
  const d = ((Math.round(degrees) % 360) + 360) % 360;
  const vf = d === 90 ? 'transpose=1' : d === 180 ? 'hflip,vflip' : d === 270 ? 'transpose=2' : d === 0 ? 'null' : `rotate=${d}*PI/180:ow=rotw(${d}*PI/180):oh=roth(${d}*PI/180):c=black`;
  return videoFilter(job, vf, { name: 'rotated.mp4', ...o });
}

/** Scale by `factor` (0.1–4), keeping the result at most 2560px on its longest side. */
export function videoResize(job: Job, factor: number, o: VideoOpts = {}) {
  const f = clamp(factor, 0.1, 4);
  const { w, h } = fitEven(job.info.width * f, job.info.height * f, 2560);
  return videoFilter(job, `scale=${w}:${h}`, { name: 'resized.mp4', ...o });
}

export type Anchor = 'center' | 'top' | 'bottom' | 'left' | 'right';
export function videoCrop(job: Job, ratio: string, anchor: Anchor, o: VideoOpts = {}) {
  const m = /^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/.exec(ratio.trim());
  if (!m || Number(m[1]) <= 0 || Number(m[2]) <= 0) throw new MediaError('Give the ratio like `16:9`, `1:1` or `9:16`.');
  const ar = Number(m[1]) / Number(m[2]);
  const x = anchor === 'left' ? '0' : anchor === 'right' ? 'iw-ow' : '(iw-ow)/2';
  const y = anchor === 'top' ? '0' : anchor === 'bottom' ? 'ih-oh' : '(ih-oh)/2';
  return videoFilter(job, `crop=w='min(iw\\,ih*${ar})':h='min(ih\\,iw/${ar})':x=${x}:y=${y}`, { name: 'cropped.mp4', ...o });
}

/** Chain atempo filters (each limited to 0.5–2×) to reach any multiplier in 0.25–4×. */
export function atempoChain(mult: number): string {
  const parts: string[] = [];
  let m = clamp(mult, 0.25, 4);
  while (m > 2) { parts.push('atempo=2.0'); m /= 2; }
  while (m < 0.5) { parts.push('atempo=0.5'); m /= 0.5; }
  parts.push(`atempo=${m.toFixed(4)}`);
  return parts.join(',');
}
export function videoSpeed(job: Job, mult: number, o: VideoOpts = {}) {
  const m = clamp(mult, 0.25, 4);
  return videoFilter(job, `setpts=PTS/${m}`, { af: atempoChain(m), name: 'speed.mp4', ...o });
}

/** An MP4 made by one of the video tools → a looping GIF (Heist's `output: GIF`). */
export async function mp4ToGif(dir: string, out: Out): Promise<Out> {
  const info = await probe(out.file, dir);
  const cap = fitEven(info.width, info.height, MAX_GIF);
  await ffmpeg(['-t', String(MAX_SECONDS), '-i', out.file, '-vf', `fps=15,scale=${cap.w}:${cap.h}:flags=lanczos,${GIF_PALETTE}`, '-loop', '0', 'out.gif'], { cwd: dir, timeoutMs: 120_000 });
  return { file: 'out.gif', name: out.name.replace(/\.\w+$/, '.gif') };
}

// ─── Audio ───────────────────────────────────────────────────────────────────

export type AudioEffect = '8d' | 'bassboost' | 'earrape' | 'lofi' | 'nightcore' | 'phonk' | 'reverse' | 'slowedandreverb' | 'spatial';
export const AUDIO_EFFECTS: { name: string; value: AudioEffect; description: string }[] = [
  { name: '8D', value: '8d', description: '8D panning audio effect' },
  { name: 'Bass boost', value: 'bassboost', description: 'Boost the bass' },
  { name: 'Earrape', value: 'earrape', description: 'Distort the audio to oblivion' },
  { name: 'Lo-fi', value: 'lofi', description: 'Chill lofi effect' },
  { name: 'Nightcore', value: 'nightcore', description: 'Speed up and pitch up the track' },
  { name: 'Phonk', value: 'phonk', description: 'Slowed phonk with echo' },
  { name: 'Reverse', value: 'reverse', description: 'Play the audio backwards' },
  { name: 'Slowed + reverb', value: 'slowedandreverb', description: 'Slowed down with reverb' },
  { name: 'Spatial', value: 'spatial', description: '3D spatial audio effect' },
];

export function audioFilter(effect: AudioEffect, sampleRate: number, level = 3): string {
  const sr = sampleRate > 8000 ? sampleRate : 44100;
  switch (effect) {
    case '8d': return 'apulsator=hz=0.125:mode=sine:amount=1,aecho=0.9:0.4:25:0.15';
    case 'bassboost': return 'bass=g=16:f=110:w=0.7,equalizer=f=60:t=q:w=1:g=6,alimiter=limit=0.9';
    case 'earrape': return `acrusher=level_in=${1 + level}:level_out=${2 + level * 2}:bits=${Math.max(3, 9 - level)}:mode=log:aa=1,alimiter=limit=1:level=false`;
    case 'lofi': return `asetrate=${Math.round(sr * 0.94)},aresample=${sr},lowpass=f=3200,highpass=f=110,acrusher=bits=11:mode=lin:mix=0.35,aecho=0.8:0.6:45:0.22,tremolo=f=0.35:d=0.12`;
    case 'nightcore': return `asetrate=${Math.round(sr * 1.25)},aresample=${sr}`;
    case 'phonk': return `asetrate=${Math.round(sr * 0.86)},aresample=${sr},bass=g=14:f=90,aecho=0.8:0.9:70|140:0.4|0.25,acrusher=bits=10:mode=lin:mix=0.2,alimiter=limit=0.92`;
    case 'reverse': return 'areverse';
    case 'slowedandreverb': return `asetrate=${Math.round(sr * 0.84)},aresample=${sr},aecho=0.8:0.85:60|110|170:0.35|0.28|0.2,lowpass=f=12000`;
    case 'spatial': return 'extrastereo=m=2.2,earwax,apulsator=hz=0.06:mode=sine:amount=0.45,aecho=0.9:0.55:35:0.18';
  }
}

export async function audioEffect(job: Job, effect: AudioEffect, level = 3): Promise<Out> {
  if (!job.info.hasAudio) throw new MediaError('That file has no audio track.');
  if (job.info.duration > 600) throw new MediaError('That\'s longer than 10 minutes — please trim it first.');
  const out = 'out.mp3';
  await ffmpeg(['-i', job.input, '-vn', '-af', audioFilter(effect, job.info.audioRate, level), '-c:a', 'libmp3lame', '-b:a', '128k', out], { cwd: job.dir, timeoutMs: 180_000 });
  return { file: out, name: `${effect}.mp3` };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
