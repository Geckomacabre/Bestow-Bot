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

export const blur = (job: Job, strength: number) => imageFilter(job, `gblur=sigma=${clamp(strength, 1, 40)}:steps=2`);
export const invert = (job: Job) => imageFilter(job, 'negate');
export const grayscale = (job: Job) => imageFilter(job, 'hue=s=0');
export const flip = (job: Job, dir: 'horizontal' | 'vertical' | 'both') => imageFilter(job, dir === 'horizontal' ? 'hflip' : dir === 'vertical' ? 'vflip' : 'hflip,vflip');

export function pixelate(job: Job, size: number) {
  const { width: w, height: h } = job.info;
  const s = clamp(size, 2, 64);
  return imageFilter(job, `scale=${Math.max(1, Math.round(w / s))}:${Math.max(1, Math.round(h / s))}:flags=neighbor,scale=${w}:${h}:flags=neighbor`);
}

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

/** Radial zoom blur: average several progressively zoomed copies. */
export function zoomBlur(job: Job, power: number) {
  const p = clamp(power, 1, 10);
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

/** White bar with black text above (or below) the media \u2014 the classic "caption" look. */
export async function caption(job: Job, rawText: string, bottom = false, video = false): Promise<Out> {
  const text = stripUnsupported(rawText);
  if (!text) throw new MediaError('There\'s no text left to draw (emoji aren\'t supported in captions).');
  const w = workWidth(job, video);
  const fontSize = Math.max(16, Math.round(w / 13));
  const lines = wrapText(text, Math.max(8, Math.floor(w / (fontSize * 0.52))));
  const lh = Math.round(fontSize * 1.22);
  const pad = Math.round(fontSize * 0.5);
  const bar = (lines.length * lh + pad * 2) & ~1;
  const font = await prepFont(job);
  const top = pad; // first baseline offset inside the bar
  const draws = await centeredLines(job, 'cap', lines, {
    font, fontSize, color: 'black', lineHeight: lh,
    y: i => (bottom ? `h-${bar}+${top + i * lh}` : String(top + i * lh)),
  });
  const vf = `pad=iw:ih+${bar}:0:${bottom ? 0 : bar}:color=white,${draws.join(',')}`;
  return video ? videoFilter(job, vf) : imageFilter(job, vf);
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

export async function watermark(job: Job, rawText: string, opts: { position: Position; opacity: number; size: number; color: string }, video = false): Promise<Out> {
  const text = stripUnsupported(rawText);
  if (!text) throw new MediaError('There\'s no text left to draw (emoji aren\'t supported in watermarks).');
  const font = await prepFont(job);
  const tf = await textFile(job, 'wm.txt', text.slice(0, 120));
  const fontSize = Math.max(10, Math.round((job.info.width * clamp(opts.size, 1, 40)) / 100 * 1.6));
  const color = /^#?[0-9a-f]{6}$/i.test(opts.color) ? opts.color.replace('#', '0x') : 'white';
  const vf = `drawtext=fontfile=${font}:textfile=${tf}:fontcolor=${color}@${clamp(opts.opacity, 5, 100) / 100}:fontsize=${fontSize}:borderw=1:bordercolor=black@${(clamp(opts.opacity, 5, 100) / 100) * 0.6}:${POS_XY[opts.position]}`;
  return video ? videoFilter(job, vf) : imageFilter(job, vf);
}

/** Put one image on another. x/y/scale are percentages of the base. */
export async function overlay(base: Job, overlayFile: string, opts: { opacity: number; x: number; y: number; scale: number }): Promise<Out> {
  const { info } = base;
  const animated = info.animated;
  const cap = animated ? MAX_GIF : MAX_STILL;
  const fit = fitEven(info.width, info.height, cap);
  const ow = Math.max(2, Math.round((fit.w * clamp(opts.scale, 1, 100)) / 100 / 2) * 2);
  const graph = `[0:v]scale=${fit.w}:${fit.h}[b];[1:v]scale=${ow}:-2,format=rgba,colorchannelmixer=aa=${clamp(opts.opacity, 0, 100) / 100}[o];[b][o]overlay=x=(W-w)*${clamp(opts.x, 0, 100) / 100}:y=(H-h)*${clamp(opts.y, 0, 100) / 100}:format=auto`;
  if (animated) {
    await ffmpeg(['-t', String(MAX_SECONDS), '-i', base.input, '-i', overlayFile, '-filter_complex', `${graph},${GIF_PALETTE}`, '-loop', '0', 'out.gif'], { cwd: base.dir });
    return { file: 'out.gif', name: 'overlay.gif' };
  }
  await ffmpeg(['-i', base.input, '-i', overlayFile, '-filter_complex', graph, '-frames:v', '1', 'out.png'], { cwd: base.dir });
  return { file: 'out.png', name: 'overlay.png' };
}

// ─── Video ───────────────────────────────────────────────────────────────────

/** Video output: H.264 + AAC, ≤1280px, ≤30s, even dimensions, streamable. */
export async function videoFilter(job: Job, vf: string, opts: { af?: string; name?: string; extraIn?: string[] } = {}): Promise<Out> {
  if (!job.info.hasVideo) throw new MediaError('That needs a video or GIF.');
  const cap = fitEven(job.info.width, job.info.height, MAX_VIDEO);
  const scaleCap = Math.max(job.info.width, job.info.height) > MAX_VIDEO ? `scale=${cap.w}:${cap.h},` : '';
  const out = 'out.mp4';
  const args = [
    '-t', String(MAX_SECONDS), ...(opts.extraIn ?? []), '-i', job.input,
    '-vf', `${scaleCap}${vf},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
    ...(job.info.hasAudio ? (opts.af ? ['-af', opts.af] : []) : ['-an']),
    '-c:v', 'libx264', '-crf', '27', '-preset', 'veryfast', '-movflags', '+faststart',
    ...(job.info.hasAudio ? ['-c:a', 'aac', '-b:a', '96k'] : []),
    out,
  ];
  await ffmpeg(args, { cwd: job.dir });
  return { file: out, name: opts.name ?? 'result.mp4' };
}

export const videoReverse = (job: Job) => videoFilter(job, 'reverse', { af: 'areverse', name: 'reversed.mp4' });
export const videoScramble = (job: Job) => videoFilter(job, 'random=frames=24', { name: 'scrambled.mp4' });

export function videoRotate(job: Job, degrees: number) {
  const d = ((Math.round(degrees) % 360) + 360) % 360;
  const vf = d === 90 ? 'transpose=1' : d === 180 ? 'hflip,vflip' : d === 270 ? 'transpose=2' : d === 0 ? 'null' : `rotate=${d}*PI/180:ow=rotw(${d}*PI/180):oh=roth(${d}*PI/180):c=black`;
  return videoFilter(job, vf, { name: 'rotated.mp4' });
}

export function videoResize(job: Job, factor: number) {
  const f = clamp(factor, 0.1, 2);
  return videoFilter(job, `scale=trunc(iw*${f}/2)*2:trunc(ih*${f}/2)*2`, { name: 'resized.mp4' });
}

export type Anchor = 'center' | 'top' | 'bottom' | 'left' | 'right';
export function videoCrop(job: Job, ratio: string, anchor: Anchor) {
  const m = /^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/.exec(ratio.trim());
  if (!m || Number(m[1]) <= 0 || Number(m[2]) <= 0) throw new MediaError('Give the ratio like `16:9`, `1:1` or `9:16`.');
  const ar = Number(m[1]) / Number(m[2]);
  const x = anchor === 'left' ? '0' : anchor === 'right' ? 'iw-ow' : '(iw-ow)/2';
  const y = anchor === 'top' ? '0' : anchor === 'bottom' ? 'ih-oh' : '(ih-oh)/2';
  return videoFilter(job, `crop=w='min(iw\\,ih*${ar})':h='min(ih\\,iw/${ar})':x=${x}:y=${y}`, { name: 'cropped.mp4' });
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
export function videoSpeed(job: Job, mult: number) {
  const m = clamp(mult, 0.25, 4);
  return videoFilter(job, `setpts=PTS/${m}`, { af: atempoChain(m), name: 'speed.mp4' });
}

/** Still image + audio → video. */
export async function imageWithAudio(dir: string, image: string, audio: string, opts: { loop: boolean; volume: number; start: number; end: number }): Promise<Out> {
  const info = await probe(image, dir);
  const cap = fitEven(info.width, info.height, MAX_VIDEO);
  const dur = opts.end > opts.start ? opts.end - opts.start : 0;
  const audioIn = ['-ss', String(Math.max(0, opts.start)), ...(dur ? ['-t', String(Math.min(dur, 120))] : ['-t', '120']), '-i', audio];
  await ffmpeg([
    '-loop', '1', '-framerate', '2', '-i', image, ...audioIn,
    ...(opts.loop ? [] : []),
    '-vf', `scale=${cap.w}:${cap.h},format=yuv420p`,
    '-af', `volume=${clamp(opts.volume, 0, 300) / 100}`,
    '-c:v', 'libx264', '-tune', 'stillimage', '-crf', '30', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', 'out.mp4',
  ], { cwd: dir });
  return { file: 'out.mp4', name: 'result.mp4' };
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
