import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { MediaError, ffmpeg, withWorkdir } from '../framework/media.js';
import { kokoroRaw } from './tts.js';
import { atempoChain } from '../media/effects.js';

/**
 * "Sing-song" voices: instant, local, free. Each word is spoken by a Kokoro voice, then pitch-shifted onto a note of
 * a melody and stretched to the beat, with vibrato and a little reverb. It sounds like a playful robot choir rather
 * than a real singer — for a real vocalist use the "AI singer" voices (a full ACE-Step song, much slower).
 */

export const SR = 24_000;
export const MAX_WORDS = 20;
const NOTE_FILL = 0.92; // fraction of each beat that is voiced; the rest is articulation gap

export interface Melody {
  id: string;
  label: string;
  blurb: string;
  /** Kokoro voice that speaks the words. */
  voice: string;
  bpm: number;
  /** Semitone offsets from the voice's natural pitch, cycled word by word. */
  pattern: number[];
  vibrato: { f: number; d: number };
  /** ffmpeg aecho args, or null. */
  echo: string | null;
  /** Extra audio filters appended before the limiter (e.g. light distortion). */
  extra?: string;
}

export const MELODIES: Melody[] = [
  { id: 'pop', label: 'Happy pop', blurb: 'Bouncy major-key melody', voice: 'af_heart', bpm: 118, pattern: [0, 2, 4, 7, 9, 7, 4, 2], vibrato: { f: 5.5, d: 0.18 }, echo: '0.8:0.5:40:0.18' },
  { id: 'ballad', label: 'Sad ballad', blurb: 'Slow, minor, dripping with feeling', voice: 'af_nicole', bpm: 68, pattern: [0, -2, -4, -2, 0, 3, 2, 0], vibrato: { f: 5, d: 0.32 }, echo: '0.85:0.6:90:0.3' },
  { id: 'opera', label: 'Opera diva', blurb: 'High, dramatic and wobbly', voice: 'af_bella', bpm: 84, pattern: [5, 7, 9, 12, 9, 7, 5, 4], vibrato: { f: 6.2, d: 0.55 }, echo: '0.85:0.7:120:0.35' },
  { id: 'lullaby', label: 'Lullaby', blurb: 'Soft and sleepy', voice: 'af_sky', bpm: 58, pattern: [0, 2, 4, 2, 0, -1, 0, 2], vibrato: { f: 4.5, d: 0.2 }, echo: '0.8:0.5:70:0.25' },
  { id: 'rock', label: 'Rock belt', blurb: 'Loud, punchy and a bit crunchy', voice: 'am_adam', bpm: 138, pattern: [0, 0, 3, 5, 7, 5, 3, 0], vibrato: { f: 5.8, d: 0.12 }, echo: '0.7:0.4:30:0.15', extra: 'acrusher=bits=11:mode=lin:mix=0.25' },
  { id: 'chipmunk', label: 'Chipmunk choir', blurb: 'Tiny and very excited', voice: 'af_nova', bpm: 150, pattern: [12, 14, 16, 14, 12, 9, 12, 14], vibrato: { f: 7, d: 0.15 }, echo: null },
  { id: 'tenor', label: 'Tenor', blurb: 'Warm, rising phrases', voice: 'am_michael', bpm: 92, pattern: [0, 2, 4, 5, 7, 5, 4, 2], vibrato: { f: 5.2, d: 0.3 }, echo: '0.85:0.6:70:0.25' },
  { id: 'alto', label: 'Alto', blurb: 'Smooth, warm and mellow', voice: 'af_jessica', bpm: 84, pattern: [0, 2, 3, 5, 3, 2, 0, -2], vibrato: { f: 5, d: 0.28 }, echo: '0.85:0.55:75:0.26' },
  { id: 'sunshine', label: 'Sunshine soon', blurb: 'Sunny, skipping and cheerful', voice: 'am_eric', bpm: 126, pattern: [0, 4, 7, 4, 9, 7, 4, 0], vibrato: { f: 6, d: 0.14 }, echo: '0.8:0.45:35:0.16' },
  { id: 'breeze', label: 'Warmy breeze', blurb: 'Gentle and floaty', voice: 'af_river', bpm: 72, pattern: [0, 3, 5, 3, 7, 5, 3, 0], vibrato: { f: 4.8, d: 0.24 }, echo: '0.8:0.55:85:0.3' },
  { id: 'glorious', label: 'Glorious', blurb: 'Big, heroic and echoing', voice: 'af_alloy', bpm: 88, pattern: [0, 4, 7, 9, 12, 9, 7, 12], vibrato: { f: 5.6, d: 0.4 }, echo: '0.85:0.75:140:0.4' },
  { id: 'goesup', label: 'It goes up', blurb: 'Every word climbs a step higher', voice: 'am_puck', bpm: 132, pattern: [-4, -2, 0, 2, 4, 6, 8, 10, 12, 14], vibrato: { f: 6.5, d: 0.2 }, echo: '0.7:0.4:25:0.12' },
  { id: 'dramatic', label: 'Dramatic', blurb: 'Slow, huge pitch jumps, maximum feeling', voice: 'af_kore', bpm: 60, pattern: [0, 7, 3, 10, 5, 12, 2, 9], vibrato: { f: 4.6, d: 0.5 }, echo: '0.85:0.7:150:0.42' },
  { id: 'crooner', label: 'Deep crooner', blurb: 'Low, smooth and slightly smug', voice: 'am_bestow', bpm: 78, pattern: [-5, -3, -1, -3, -5, -8, -5, -3], vibrato: { f: 5, d: 0.28 }, echo: '0.85:0.6:80:0.28' },
];

export const findMelody = (id: string) => MELODIES.find(m => m.id === id) ?? null;

// ─── Planning (pure) ─────────────────────────────────────────────────────────

export interface Token { word: string; hold: boolean }
export interface Note { word: string; semitones: number; beats: number }

/** Words to sing. A word before punctuation (or the last one) is held for two beats. */
export function tokenize(text: string, max = MAX_WORDS): Token[] {
  const out: Token[] = [];
  const re = /([\p{L}\p{N}][\p{L}\p{N}'’-]*)([^\p{L}\p{N}\s]*)/gu;
  for (const m of text.matchAll(re)) {
    const word = m[1]!.slice(0, 20);
    out.push({ word, hold: /[,.;:!?…—-]/.test(m[2] ?? '') });
    if (out.length >= max) break;
  }
  if (out.length) out[out.length - 1]!.hold = true;
  return out;
}

export function planNotes(tokens: Token[], melody: Pick<Melody, 'pattern'>): Note[] {
  return tokens.map((t, i) => ({ word: t.word, semitones: melody.pattern[i % melody.pattern.length]!, beats: t.hold ? 2 : 1 }));
}

export const beatSeconds = (bpm: number) => 60 / bpm;
export const totalSeconds = (notes: Note[], bpm: number) => notes.reduce((s, n) => s + n.beats, 0) * beatSeconds(bpm);

// ─── PCM helpers ─────────────────────────────────────────────────────────────

/** Drop leading/trailing near-silence, keeping ~10 ms of padding. */
export function trimSilence(samples: Float32Array, threshold = 0.012, rate = SR): Float32Array {
  let a = 0, b = samples.length - 1;
  while (a < b && Math.abs(samples[a]!) < threshold) a++;
  while (b > a && Math.abs(samples[b]!) < threshold) b--;
  const pad = Math.round(rate * 0.01);
  return samples.slice(Math.max(0, a - pad), Math.min(samples.length, b + 1 + pad));
}

export function pcmToWav(samples: Float32Array, rate = SR): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i]! * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// ─── Rendering ───────────────────────────────────────────────────────────────

export interface Segment { wav: Buffer; seconds: number; semitones: number; beats: number }

/**
 * Build the ffmpeg filtergraph: each word → pitch (asetrate) → fit to its beat (atempo, then pad/trim) → vibrato →
 * click-free fades; all concatenated, then reverb + limiter.
 */
export function buildGraph(segments: Segment[], m: Pick<Melody, 'bpm' | 'vibrato' | 'echo' | 'extra'>): string {
  const beat = beatSeconds(m.bpm);
  const chains = segments.map((s, i) => {
    const r = 2 ** (s.semitones / 12);
    const D = s.beats * beat;
    const S = D * NOTE_FILL;
    const shifted = s.seconds / r;                       // duration after the pitch change
    const t = Math.min(2, Math.max(0.3, shifted / S));   // >1 speeds up, <1 slows down (stretched notes chain atempo stages)
    const fadeOut = Math.max(0.01, Math.min(0.04, D / 6));
    return `[${i}:a]asetrate=${Math.round(SR * r)},aresample=${SR},${atempoChain(t)},apad=whole_dur=${D.toFixed(4)},atrim=end=${D.toFixed(4)},` +
      `vibrato=f=${m.vibrato.f}:d=${m.vibrato.d},afade=t=in:d=0.008,afade=t=out:st=${(D - fadeOut).toFixed(4)}:d=${fadeOut.toFixed(4)}[a${i}]`;
  });
  const join = `${segments.map((_, i) => `[a${i}]`).join('')}concat=n=${segments.length}:v=0:a=1`;
  const post = [m.echo ? `aecho=${m.echo}` : null, m.extra ?? null, 'alimiter=limit=0.9', 'loudnorm=I=-16:TP=-1.5:LRA=9'].filter(Boolean).join(',');
  return `${chains.join(';')};${join},${post}[out]`;
}

export async function renderMelody(dir: string, segments: Segment[], m: Pick<Melody, 'bpm' | 'vibrato' | 'echo' | 'extra'>, output = 'sing.mp3'): Promise<string> {
  if (!segments.length) throw new MediaError('There\'s nothing to sing.');
  const inputs: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    await writeFile(path.join(dir, `w${i}.wav`), segments[i]!.wav);
    inputs.push('-i', `w${i}.wav`);
  }
  await ffmpeg([...inputs, '-filter_complex', buildGraph(segments, m), '-map', '[out]', '-c:a', 'libmp3lame', '-q:a', '3', output], { cwd: dir, timeoutMs: 60_000 });
  return output;
}

// ─── Word synthesis with a small cache ───────────────────────────────────────

const cache = new Map<string, Float32Array>();
async function wordAudio(word: string, voice: string): Promise<Float32Array> {
  const key = `${voice}|${word.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const raw = await kokoroRaw(word, voice, 1);
  const trimmed = trimSilence(raw);
  if (trimmed.length < SR * 0.04) throw new MediaError(`I couldn't pronounce "${word}".`);
  cache.set(key, trimmed);
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return trimmed;
}

export interface SingLiteResult { mp3: Buffer; seconds: number; words: number; melody: Melody }

export async function singLite(text: string, melodyId: string): Promise<SingLiteResult> {
  const melody = findMelody(melodyId);
  if (!melody) throw new MediaError('Unknown singing voice.');
  const tokens = tokenize(text);
  if (!tokens.length) throw new MediaError('Give me some words to sing.');
  const notes = planNotes(tokens, melody);
  const segments: Segment[] = [];
  for (const n of notes) {
    const samples = await wordAudio(n.word, melody.voice);
    segments.push({ wav: pcmToWav(samples), seconds: samples.length / SR, semitones: n.semitones, beats: n.beats });
  }
  return withWorkdir(async dir => {
    const file = await renderMelody(dir, segments, melody);
    return { mp3: await readFile(path.join(dir, file)), seconds: totalSeconds(notes, melody.bpm), words: notes.length, melody };
  });
}
