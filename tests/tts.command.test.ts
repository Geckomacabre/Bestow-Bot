import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import Tts from '../src/commands/media/tts';
import { ALL_VOICES, CHAR_STYLES, CHAR_VOICES, SING_VOICES, SONG_VOICES, SONG_STYLES, findVoice, searchVoices, speak } from '../src/services/tts';
import { fakeInteraction, textOf } from './fakeInteraction';

// Mock ACE-Step server (same contract as the real one).
let server: ReturnType<typeof Bun.serve>;
let lastSubmit: any = null;
let polls = 0;
let healthy = true;

beforeAll(() => {
  Bun.env.SING_POLL_MS = '5';
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === '/health') return healthy ? Response.json({ data: { status: 'ok' }, code: 200 }) : new Response('down', { status: 503 });
      if (u.pathname === '/release_task') { lastSubmit = await req.json(); polls = 0; return Response.json({ data: { task_id: 't', queue_position: 0 }, code: 200 }); }
      if (u.pathname === '/query_result') {
        polls++;
        return Response.json({ data: [{ task_id: 't', status: polls < 2 ? 0 : 1, result: JSON.stringify([{ file: '/v1/audio?path=x', metas: { bpm: 96, keyscale: 'A minor', duration: 30 } }]) }], code: 200 });
      }
      if (u.pathname === '/v1/audio') return new Response(Buffer.from('ID3-song'), { headers: { 'content-type': 'audio/mpeg' } });
      return new Response('?', { status: 404 });
    },
  });
  Bun.env.ACESTEP_URL = `http://127.0.0.1:${server.port}`;
});
afterAll(() => { server.stop(true); delete Bun.env.ACESTEP_URL; delete Bun.env.SING_POLL_MS; });

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

describe('/tts voicemessage option', () => {
  test('falls back to an attachment with a note when Discord refuses the voice message', async () => {
    const f = fakeInteraction({ options: { text: 'hello there friend', voice: 'song:pop-female', voicemessage: true }, userId: 'vm-fallback', restFails: true });
    await (Tts.run as (i: any) => Promise<unknown>)(f.interaction);
    const payload = f.last();
    // (AI-singer path: the mock ACE-Step server returns fake bytes, which can't be transcoded — so it lands in the attachment fallback.)
    expect(payload.files?.[0]?.name).toBe('song.mp3');
    expect(payload.content).toContain('attached the audio instead');
    expect(f.wasDeleted()).toBe(false);
  });
});

describe('/tts command', () => {
  test('an unknown voice gets a helpful error', async () => {
    const r = await run({ text: 'hi', voice: 'not-a-voice' });
    expect(r.file).toBeUndefined();
    expect(r.text).toContain('don\'t know a voice');
  });

  test('AI singer: short text becomes the lyrics when no AI is configured, and a song comes back', async () => {
    delete Bun.env.LLM_BASE_URL; delete Bun.env.LLM_MODEL;
    const r = await run({ text: 'twinkle twinkle little star', voice: 'song:pop-female' });
    expect(r.file?.name).toBe('song.mp3');
    expect(Buffer.from(r.file.attachment).toString()).toBe('ID3-song');
    expect(r.text).toContain('Pop singer');
    expect(r.text).toContain('96 BPM');
    expect(lastSubmit.prompt).toBe(SONG_STYLES['pop-female']!.prompt);
    expect(lastSubmit.lyrics).toContain('twinkle twinkle little star');
    expect(lastSubmit.audio_duration).toBe(30);
  });

  test('AI singer: a long text is used verbatim as lyrics', async () => {
    const lyrics = '[verse]\nline one is here for you today\nline two goes on and on and on\n[chorus]\nsing it loud';
    await run({ text: lyrics, voice: 'song:rock-male' });
    expect(lastSubmit.lyrics).toBe(lyrics);
    expect(lastSubmit.prompt).toContain('rock');
  });

  test('AI singer: studio offline → friendly message pointing at the quick voices, cooldown refunded', async () => {
    healthy = false;
    const user = 'offline-user';
    const a = await run({ text: 'hello there', voice: 'song:ballad' }, user);
    expect(a.file).toBeUndefined();
    expect(a.text).toContain('isn\'t running');
    healthy = true;
    const b = await run({ text: 'hello there', voice: 'song:ballad' }, user); // not blocked by a cooldown
    expect(b.file?.name).toBe('song.mp3');
  });

  test('AI singer: a second full song right away is rate limited', async () => {
    const user = 'rate-user';
    const a = await run({ text: 'la la la la', voice: 'song:lofi' }, user);
    expect(a.file).toBeDefined();
    const b = await run({ text: 'la la la la', voice: 'song:lofi' }, user);
    expect(b.file).toBeUndefined();
    expect(b.text).toContain('breather');
  });
});

// Needs the real ~90 MB Kokoro model: RUN_TTS_TEST=1
const real = Bun.env.RUN_TTS_TEST === '1' ? test : test.skip;
describe('/tts with the real local model (opt-in)', () => {
  real('speech voice → speech.mp3', async () => {
    const r = await run({ text: 'Testing one two three', voice: 'am_onyx' });
    expect(r.file?.name).toBe('speech.mp3');
    expect(r.text).toContain('Onyx');
    expect(Buffer.from(r.file.attachment).length).toBeGreaterThan(2000);
  }, 120_000);

  real('singing voice → singing.mp3 with the melody named', async () => {
    const r = await run({ text: 'Twinkle twinkle little star', voice: 'sing:lullaby' });
    expect(r.file?.name).toBe('singing.mp3');
    expect(r.text).toContain('Lullaby');
    expect(r.text).toMatch(/4 words/);
  }, 120_000);

  real('sing-song voices have a short cooldown', async () => {
    const user = 'lite-user';
    expect((await run({ text: 'hi there', voice: 'sing:pop' }, user)).file).toBeDefined();
    const again = await run({ text: 'hi there', voice: 'sing:pop' }, user);
    expect(again.file).toBeUndefined();
    expect(again.text).toContain('Slow down');
  }, 120_000);

  real('only the first 20 words are sung, and the reply says so', async () => {
    const r = await run({ text: Array.from({ length: 30 }, (_, i) => `word${i}`).join(' '), voice: 'sing:chipmunk' });
    expect(r.text).toContain('first 20 words');
  }, 180_000);

  real('every character voice makes audio that differs from the plain voice', async () => {
    const plain = await run({ text: 'Hello there, this is a test.', voice: 'am_adam' });
    for (const id of ['trooper', 'masked', 'rascal', 'robot']) {
      const r = await run({ text: 'Hello there, this is a test.', voice: `char:${id}` });
      expect(r.file?.name, id).toBe('speech.mp3');
      expect(r.text, id).toContain('🎭');
      expect(Buffer.compare(Buffer.from(r.file.attachment), Buffer.from(plain.file.attachment)), id).not.toBe(0);
    }
  }, 240_000);

  real('voicemessage: posts an OGG/Opus voice message and removes the placeholder reply', async () => {
    const f = fakeInteraction({ options: { text: 'This should arrive as a voice message.', voice: 'af_heart', voicemessage: true }, userId: 'vm-real' });
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
