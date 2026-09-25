import { describe, expect, test } from 'bun:test';
import Tts, { HEIST_VOICES } from '../src/commands/media/tts';
import { heistSpec } from '../src/framework/heist';
import { ALL_VOICES, CHAR_STYLES, CHAR_VOICES, SING_VOICES, SONG_VOICES, SONG_STYLES, findVoice, searchVoices, speak } from '../src/services/tts';
import { fakeInteraction, textOf } from './fakeInteraction';

let n = 0;
const run = async (options: Record<string, string | number>, userId = `tts-u${++n}`) => {
  const f = fakeInteraction({ options, userId });
  await (Tts.run as (i: any) => Promise<unknown>)(f.interaction);
  const payload = f.last();
  return { ...f, payload, file: payload?.files?.[0], text: textOf(payload) };
};

describe('voice list', () => {
  test('singing voices are in the default autocomplete list', () => {
    const shown = searchVoices('');
    expect(shown.length).toBeLessThanOrEqual(25);
    for (const v of SING_VOICES) expect(shown.map(x => x.id)).toContain(v.id);
    expect(shown.filter(x => x.engine === 'song').length).toBeGreaterThanOrEqual(4); // AI singers are visible too
    for (const v of CHAR_VOICES) expect(shown.map(x => x.id)).toContain(v.id);
    expect(shown.some(x => x.engine === 'kokoro')).toBe(true);
  });
  test('searching "sing" finds both kinds of singer', () => {
    const r = searchVoices('sing');
    expect(r.some(v => v.engine === 'sing')).toBe(true);
    expect(r.some(v => v.engine === 'song')).toBe(true);
    expect(searchVoices('opera').map(v => v.id)).toEqual(expect.arrayContaining(['sing:opera', 'song:opera']));
  });
  test('every AI singer has a style prompt, ids stay unique', () => {
    expect(SONG_VOICES.map(v => v.id.replace('song:', '')).sort()).toEqual(Object.keys(SONG_STYLES).sort());
    for (const s of Object.values(SONG_STYLES)) expect(s.prompt.length).toBeGreaterThan(20);
    const ids = ALL_VOICES.map(v => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findVoice('sing:pop')!.engine).toBe('sing');
    expect(findVoice('song:rap')!.engine).toBe('song');
  });
  test('character voices resolve, are searchable and each names a real base voice', () => {
    expect(searchVoices('char').map(v => v.engine)).toContain('char');
    for (const [id, c] of Object.entries(CHAR_STYLES)) {
      expect(findVoice(`char:${id}`)!.engine).toBe('char');
      expect(findVoice(c.base), id).not.toBeNull();
      expect(c.fx.length).toBeGreaterThan(10);
    }
  });
  test('plain speech refuses a singing voice', async () => {
    await expect(speak('hello', 'sing:pop')).rejects.toThrow(/singing voice/);
  });
});

describe('/tts voices are exactly Heist\'s', () => {
  test('every Heist voice choice maps to a real Bestow voice of the right kind', () => {
    const choices = heistSpec('tts').args.find(a => a.name === 'voice')!.choices;
    expect(Object.keys(HEIST_VOICES).sort()).toEqual([...choices].sort());
    for (const [name, id] of Object.entries(HEIST_VOICES)) {
      const v = findVoice(id);
      expect(v, name).not.toBeNull();
      if (name.endsWith('(Singing)')) expect(v!.engine, name).toBe('sing');
      else if (name.endsWith('(Char)')) expect(v!.engine, name).toBe('char');
      else expect(v!.engine, name).toBe('kokoro');
    }
  });
  test('the registered /tts has Heist\'s options: text, voice (13 choices), voicemessage', () => {
    const j = Tts.data.toJSON() as { options: { name: string; choices?: unknown[] }[] };
    expect(j.options.map(o => o.name)).toEqual(['text', 'voice', 'voicemessage']);
    expect(j.options[1]!.choices).toHaveLength(13);
  });
  test('an unknown voice gets a helpful error', async () => {
    const r = await run({ text: 'hi', voice: 'not-a-voice' });
    expect(r.file).toBeUndefined();
    expect(r.text).toContain('don\'t know that voice');
  });
});

// Needs the real ~90 MB Kokoro model: RUN_TTS_TEST=1
const real = Bun.env.RUN_TTS_TEST === '1' ? test : test.skip;
describe('/tts with the real local model (opt-in)', () => {
  real('speech voice → speech.mp3', async () => {
    const r = await run({ text: 'Testing one two three', voice: 'Male' });
    expect(r.file?.name).toBe('speech.mp3');
    expect(r.text).toContain('Male');
    expect(Buffer.from(r.file.attachment).length).toBeGreaterThan(2000);
  }, 120_000);

  real('singing voice → singing.mp3 with the melody named', async () => {
    const r = await run({ text: 'Twinkle twinkle little star', voice: 'Tenor (Singing)' });
    expect(r.file?.name).toBe('singing.mp3');
    expect(r.text).toContain('Tenor (Singing)');
    expect(r.text).toMatch(/4 words/);
  }, 120_000);

  real('sing-song voices have a short cooldown', async () => {
    const user = 'lite-user';
    expect((await run({ text: 'hi there', voice: 'Glorious (Singing)' }, user)).file).toBeDefined();
    const again = await run({ text: 'hi there', voice: 'Glorious (Singing)' }, user);
    expect(again.file).toBeUndefined();
    expect(again.text).toContain('Slow down');
  }, 120_000);

  real('only the first 20 words are sung, and the reply says so', async () => {
    const r = await run({ text: Array.from({ length: 30 }, (_, i) => `word${i}`).join(' '), voice: 'Chipmunk (Singing)' });
    expect(r.text).toContain('first 20 words');
  }, 180_000);

  real('every character voice makes audio that differs from the plain voice', async () => {
    const plain = await run({ text: 'Hello there, this is a test.', voice: 'Male 2' });
    for (const id of ['Stormtrooper (Char)', 'Ghostface (Char)', 'Rocket (Char)']) {
      const r = await run({ text: 'Hello there, this is a test.', voice: id });
      expect(r.file?.name, id).toBe('speech.mp3');
      expect(r.text, id).toContain('🎭');
      expect(Buffer.compare(Buffer.from(r.file.attachment), Buffer.from(plain.file.attachment)), id).not.toBe(0);
    }
  }, 240_000);

  real('voicemessage: posts an OGG/Opus voice message and removes the placeholder reply', async () => {
    const f = fakeInteraction({ options: { text: 'This should arrive as a voice message.', voice: 'Female', voicemessage: true }, userId: 'vm-real' });
    await (Tts.run as (i: any) => Promise<unknown>)(f.interaction);
    expect(f.restPosts).toHaveLength(1);
    const { body, files } = f.restPosts[0]!.options;
    expect(body.flags).toBe(8192);
    expect(body.attachments[0].duration_secs).toBeGreaterThan(1);
    expect(Buffer.from(body.attachments[0].waveform, 'base64').length).toBeLessThanOrEqual(256);
    expect(files[0].data.subarray(0, 4).toString('ascii')).toBe('OggS');
    expect(f.wasDeleted()).toBe(true);
  }, 120_000);
});
