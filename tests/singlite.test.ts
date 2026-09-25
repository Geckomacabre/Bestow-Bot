import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  MELODIES, SR, beatSeconds, buildGraph, findMelody, pcmToWav, planNotes, renderMelody, singLite, tokenize, totalSeconds, trimSilence, type Segment,
} from '../src/services/singlite';
import { ffmpeg, probe } from '../src/framework/media';

const haveFfmpeg = !!Bun.which('ffmpeg');
const it = haveFfmpeg ? test : test.skip;

describe('tokenize / planNotes', () => {
  test('splits words, strips punctuation, holds phrase-final words', () => {
    const t = tokenize("Hello, world! it's a fine-day");
    expect(t.map(x => x.word)).toEqual(['Hello', 'world', "it's", 'a', 'fine-day']);
    expect(t.map(x => x.hold)).toEqual([true, true, false, false, true]); // comma, exclamation, and the last word
  });
  test('caps the number of words and the length of each', () => {
    expect(tokenize('a '.repeat(100)).length).toBe(20);
    expect(tokenize('x'.repeat(100))[0]!.word.length).toBe(20);
    expect(tokenize('   ...   ')).toEqual([]);
    expect(tokenize('日本語 テキスト').length).toBe(2);
  });
  test('notes cycle through the melody pattern and held words get 2 beats', () => {
    const notes = planNotes(tokenize('one two three, four'), { pattern: [0, 2, 4] });
    expect(notes.map(n => n.semitones)).toEqual([0, 2, 4, 0]);
    expect(notes.map(n => n.beats)).toEqual([1, 1, 2, 2]);
  });
  test('total length follows the tempo', () => {
    const notes = planNotes(tokenize('a b c d'), { pattern: [0] });
    expect(totalSeconds(notes, 120)).toBeCloseTo(5 * 0.5, 6); // 3 one-beat words + a held final word (2 beats)
    expect(beatSeconds(60)).toBe(1);
  });
});

describe('melodies', () => {
  test('every preset is well-formed and uses a real Kokoro voice', () => {
    const ids = new Set<string>();
    for (const m of MELODIES) {
      expect(ids.has(m.id)).toBe(false); ids.add(m.id);
      expect(m.bpm).toBeGreaterThan(40); expect(m.bpm).toBeLessThan(200);
      expect(m.pattern.length).toBeGreaterThanOrEqual(4);
      expect(m.pattern.every(p => Math.abs(p) <= 16)).toBe(true);
      expect(m.voice).toMatch(/^(af|am|bf|bm)_/);
    }
  });
  test('every "sing:" voice in the voice list maps to a melody (and vice versa)', async () => {
    const { SING_VOICES } = await import('../src/services/tts');
    expect(SING_VOICES.map(v => v.id.replace('sing:', '')).sort()).toEqual(MELODIES.map(m => m.id).sort());
    expect(findMelody('nope')).toBeNull();
  });
});

describe('PCM helpers', () => {
  test('trimSilence removes quiet edges but keeps a little padding', () => {
    const s = new Float32Array(SR);
    for (let i = 5000; i < 9000; i++) s[i] = 0.5 * Math.sin(i / 10);
    const t = trimSilence(s);
    expect(t.length).toBeGreaterThan(4000);
    expect(t.length).toBeLessThan(4000 + 2 * SR * 0.02);
    expect(trimSilence(new Float32Array(100)).length).toBeLessThanOrEqual(2 * Math.round(SR * 0.01) + 1);
  });
  test('pcmToWav writes a valid 16-bit mono header', () => {
    const w = pcmToWav(new Float32Array([0, 0.5, -0.5, 1]));
    expect(w.toString('ascii', 0, 4)).toBe('RIFF');
    expect(w.toString('ascii', 8, 12)).toBe('WAVE');
    expect(w.readUInt16LE(22)).toBe(1);
    expect(w.readUInt32LE(24)).toBe(SR);
    expect(w.readUInt16LE(34)).toBe(16);
    expect(w.readUInt32LE(40)).toBe(8);
    expect(w.readInt16LE(46)).toBe(16384); // 0.5 → 16384
  });
  test('the graph has one chain per word and concatenates them', () => {
    const segs: Segment[] = [1, 2, 3].map(() => ({ wav: Buffer.alloc(0), seconds: 0.3, semitones: 2, beats: 1 }));
    const g = buildGraph(segs, { bpm: 100, vibrato: { f: 5, d: 0.2 }, echo: '0.8:0.5:40:0.2' });
    expect(g.match(/\[\d:a\]asetrate/g)!.length).toBe(3);
    expect(g).toContain('concat=n=3:v=0:a=1');
    expect(g.endsWith('[out]')).toBe(true);
  });
});

/** Zero-crossing frequency estimate of a decoded mono s16 signal window. */
function freqOf(pcm: Int16Array, from: number, to: number, rate: number): number {
  let zc = 0;
  for (let i = from + 1; i < to; i++) if ((pcm[i - 1]! < 0) !== (pcm[i]! < 0)) zc++;
  return zc / 2 / ((to - from) / rate);
}

describe('rendering (real ffmpeg, synthetic 220 Hz "words")', () => {
  const sine = (hz: number, seconds: number) => {
    const s = new Float32Array(Math.round(SR * seconds));
    for (let i = 0; i < s.length; i++) s[i] = 0.6 * Math.sin((2 * Math.PI * hz * i) / SR);
    return pcmToWav(s);
  };

  it('shifts each note to the requested pitch and keeps the beat grid', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bestow-sing-'));
    const bpm = 120, beat = 0.5;
    const semis = [0, 12, -12, 7];
    // 1.2 s words so every note (even after pitching) has plenty of sound to measure.
    const segs: Segment[] = semis.map(st => ({ wav: sine(220, 1.2), seconds: 1.2, semitones: st, beats: 2 }));
    const file = await renderMelody(dir, segs, { bpm, vibrato: { f: 5, d: 0 }, echo: null });
    const info = await probe(file, dir);
    expect(info.duration).toBeGreaterThan(semis.length * 2 * beat - 0.25);
    expect(info.duration).toBeLessThan(semis.length * 2 * beat + 0.4);

    await ffmpeg(['-i', file, '-f', 's16le', '-ac', '1', '-ar', String(SR), 'out.pcm'], { cwd: dir });
    const raw = await readFile(path.join(dir, 'out.pcm'));
    const pcm = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2));
    const noteLen = 2 * beat; // seconds per note
    semis.forEach((st, i) => {
      const from = Math.round((i * noteLen + 0.1) * SR), to = Math.round((i * noteLen + 0.4) * SR);
      const expected = 220 * 2 ** (st / 12);
      const got = freqOf(pcm, from, to, SR);
      expect(Math.abs(got - expected) / expected, `note ${i} (${st} st): expected ${expected.toFixed(0)} Hz, got ${got.toFixed(0)} Hz`).toBeLessThan(0.06);
    });
  }, 60_000);

  it('a note is stretched or squeezed to fit its beat', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bestow-sing-'));
    const long = await renderMelody(dir, [{ wav: sine(220, 1.5), seconds: 1.5, semitones: 0, beats: 2 }], { bpm: 120, vibrato: { f: 5, d: 0 }, echo: null }, 'long.mp3');
    const short = await renderMelody(dir, [{ wav: sine(220, 0.1), seconds: 0.1, semitones: 0, beats: 2 }], { bpm: 120, vibrato: { f: 5, d: 0 }, echo: null }, 'short.mp3');
    expect((await probe(long, dir)).duration).toBeCloseTo(1, 0);
    expect((await probe(short, dir)).duration).toBeCloseTo(1, 0);
  }, 60_000);

  it('refuses to render nothing', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bestow-sing-'));
    await expect(renderMelody(dir, [], { bpm: 100, vibrato: { f: 5, d: 0.2 }, echo: null })).rejects.toThrow(/nothing to sing/);
  });

  it('every melody\'s effect chain is accepted by ffmpeg', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bestow-sing-'));
    for (const m of MELODIES) {
      const file = await renderMelody(dir, [0, 2, 4].map(st => ({ wav: sine(200, 0.3), seconds: 0.3, semitones: st + m.pattern[0]!, beats: 1 })), m, `${m.id}.mp3`);
      expect((await probe(file, dir)).hasAudio, m.id).toBe(true);
    }
  }, 120_000);
});

const real = Bun.env.RUN_TTS_TEST === '1' ? test : test.skip;
describe('singing with the real Kokoro model (opt-in)', () => {
  real('every sing-song voice produces audio of about the planned length', async () => {
    for (const m of MELODIES) {
      const r = await singLite('Happy birthday to you, happy birthday to you', m.id);
      const dir = await mkdtemp(path.join(os.tmpdir(), 'bestow-sing-'));
      await Bun.write(path.join(dir, 'x.mp3'), r.mp3);
      const p = await probe('x.mp3', dir);
      expect(p.hasAudio, m.id).toBe(true);
      expect(Math.abs(p.duration - r.seconds), `${m.id}: ${p.duration} vs ${r.seconds}`).toBeLessThan(0.6);
    }
  }, 300_000);
});
