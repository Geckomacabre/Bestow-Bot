import { describe, expect, test } from 'bun:test';
import { ALL_VOICES, DEFAULT_VOICE, EDGE_VOICES, KOKORO_VOICES, cleanForSpeech, findVoice, searchVoices, speak, ttsCooldown, TTS_COOLDOWN_MS } from '../src/services/tts';
import { probe } from '../src/framework/media';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('cleanForSpeech', () => {
  test('strips markdown, links, mentions, custom emoji and emoji', () => {
    expect(cleanForSpeech('**Hello** _there_ ~~x~~ <@123456789> check https://example.com/a?b=1 <:pog:12345> 😀 done')).toBe('Hello there x someone check link pog done');
    expect(cleanForSpeech('```js\nconsole.log(1)\n``` after')).toBe('code block after');
    expect(cleanForSpeech('a `inline` b <#99> <t:1700000000:R>')).toBe('a inline b a channel');
    expect(cleanForSpeech('   \n\t  ')).toBe('');
  });
});

describe('voices', () => {
  test('ids are unique and every voice has a language', () => {
    const ids = ALL_VOICES.map(v => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const v of ALL_VOICES) expect(v.lang).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
  });
  test('kokoro voices follow the model naming scheme (accent + gender prefix)', () => {
    for (const v of KOKORO_VOICES) {
      expect(v.id).toMatch(/^(af|am|bf|bm)_[a-z]+$/);
      expect(v.id.startsWith('af') || v.id.startsWith('bf') ? 'Female' : 'Male').toBe(v.gender);
    }
    expect(KOKORO_VOICES.length).toBe(28);
  });
  test('edge voices are prefixed so they can never collide', () => {
    for (const v of EDGE_VOICES) expect(v.id.startsWith('edge:')).toBe(true);
  });
  test('findVoice resolves ids, labels, defaults and rejects unknowns', () => {
    expect(findVoice(null)!.id).toBe(DEFAULT_VOICE);
    expect(findVoice('AM_ONYX')!.id).toBe('am_onyx');
    expect(findVoice('Heart')!.id).toBe('af_heart');
    expect(findVoice('edge:en-US-AriaNeural')!.engine).toBe('edge');
    expect(findVoice('nope')).toBeNull();
  });
  test('searchVoices filters by name, language and gender and caps at 25', () => {
    expect(searchVoices('onyx').map(v => v.id)).toContain('am_onyx');
    expect(searchVoices('ja-JP').every(v => v.lang === 'ja-JP')).toBe(true);
    expect(searchVoices('male').length).toBeGreaterThan(0);
    expect(searchVoices('').length).toBeLessThanOrEqual(25);
  });
});

describe('cooldown', () => {
  test('allows once, then blocks until the cooldown passes', () => {
    const now = 1_000_000;
    expect(ttsCooldown('cd-user', now)).toBe(0);
    expect(ttsCooldown('cd-user', now + 1000)).toBe(TTS_COOLDOWN_MS - 1000);
    expect(ttsCooldown('cd-user', now + TTS_COOLDOWN_MS)).toBe(0);
    expect(ttsCooldown('other-user', now + 1)).toBe(0); // per-user
  });
});

// Real synthesis: needs the ~90 MB model (downloaded once into data/models). Opt in with RUN_TTS_TEST=1.
const real = Bun.env.RUN_TTS_TEST === '1' ? test : test.skip;
describe('synthesis (opt-in)', () => {
  real('kokoro speaks, speed changes duration, output is a real mp3', async () => {
    const text = 'This is a short sentence to time the voice.';
    const normal = await speak(text, 'af_heart', 1);
    const fast = await speak(text, 'af_heart', 1.6);
    expect(normal.voice.engine).toBe('kokoro');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'onyx-tts-'));
    await writeFile(path.join(dir, 'a.mp3'), normal.mp3);
    await writeFile(path.join(dir, 'b.mp3'), fast.mp3);
    const a = await probe('a.mp3', dir), b = await probe('b.mp3', dir);
    expect(a.hasAudio).toBe(true);
    expect(a.duration).toBeGreaterThan(1.5);
    expect(b.duration).toBeLessThan(a.duration * 0.8);
  }, 180_000);

  real('rejects empty and unknown-voice input', async () => {
    await expect(speak('<@1> ', 'af_heart')).resolves.toBeTruthy(); // "someone"
    await expect(speak('😀😀', 'af_heart')).rejects.toThrow(/nothing speakable/);
    await expect(speak('hi', 'no-such-voice')).rejects.toThrow(/voice/);
  }, 120_000);
});
