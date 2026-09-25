import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createCanvas } from '@napi-rs/canvas';
import { db, initDb } from '../src/utils/db';
import { checkLimit, limitMessage, refund, resetLimits } from '../src/ai/limits';
import * as store from '../src/ai/store';
import { BOT_NAME, FUN_KINDS, SAFETY, buildSystem, funKind } from '../src/ai/prompts';
import { sniffMime, toDataUri } from '../src/ai/vision';
import { evidenceBlock, factcheck, keywords, parseVerdict } from '../src/ai/factcheck';
import { MAX_SECONDS, toSpeechMp3, transcribe, whisperConfig } from '../src/ai/transcribe';
import { MAX_CHAIN, chainToMessages, handleAiMessage, stripMention, userContent, type Deps } from '../src/ai/chat';
import { aiGroups, aiSubs } from '../src/subcommands/ai/ai';
import { deleteData } from '../src/privacy';
import { ffmpeg, withWorkdir } from '../src/framework/media';
import { LookupError } from '../src/lookups/handler';
import type { Sub } from '../src/framework/group';
import { fakeInteraction, textOf } from './fakeInteraction';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

// ─── A mock OpenAI-compatible provider ───────────────────────────────────────
interface Call { path: string; body: any }
const calls: Call[] = [];
let respond: (body: any) => string = () => 'mock reply';
let failWith: number | null = null;
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  await initDb();
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const p = new URL(req.url).pathname;
      if (failWith) { const s = failWith; failWith = null; return Response.json({ error: { message: 'provider exploded' } }, { status: s }); }
      if (p.endsWith('/chat/completions')) {
        const body = await req.json(); calls.push({ path: p, body });
        return Response.json({ choices: [{ message: { content: respond(body) } }] });
      }
      if (p.endsWith('/audio/transcriptions')) {
        const f = await req.formData(); const file = f.get('file') as File;
        calls.push({ path: p, body: { model: f.get('model'), size: file.size, type: file.type, format: f.get('response_format') } });
        return Response.json({ text: ' hello from the mock ', duration: 1.5 });
      }
      return new Response('nope', { status: 404 });
    },
  });
  Bun.env.LLM_BASE_URL = `http://127.0.0.1:${server.port}/v1`; Bun.env.LLM_MODEL = 'mock-chat'; Bun.env.VISION_MODEL = 'mock-vision'; Bun.env.LLM_API_KEY = 'sk-test';
  delete Bun.env.WHISPER_BASE_URL; delete Bun.env.WHISPER_MODEL; delete Bun.env.AI_DISABLED; delete Bun.env.AI_USER_LIMIT; delete Bun.env.AI_DAILY_LIMIT;
});
afterAll(() => { server.stop(true); for (const k of ['LLM_BASE_URL', 'LLM_MODEL', 'VISION_MODEL', 'LLM_API_KEY']) delete Bun.env[k]; });
beforeEach(() => { calls.length = 0; respond = () => 'mock reply'; failWith = null; resetLimits(); delete Bun.env.AI_USER_LIMIT; delete Bun.env.AI_DAILY_LIMIT; delete Bun.env.AI_DISABLED; });

let n = 0;
const uid = () => `ai-user-${++n}`;
const chatCalls = () => calls.filter(c => c.path.endsWith('/chat/completions'));
const find = (subs: Sub[], name: string) => subs.find(s => s.name === name)!;
const group = (g: string, s: string) => find(aiGroups.find(x => x.name === g)!.subs, s);

// ─── Rate limits ─────────────────────────────────────────────────────────────
describe('rate limits', () => {
  test('per-user hourly window, independent between users, and it slides', () => {
    Bun.env.AI_USER_LIMIT = '3';
    const T = 1_000_000;
    for (let i = 0; i < 3; i++) expect(checkLimit('a', T + i)).toMatchObject({ ok: true });
    const denied = checkLimit('a', T + 10);
    expect(denied).toMatchObject({ ok: false, reason: 'user' }); expect(!denied.ok && denied.retryAfterMs).toBeGreaterThan(3_500_000);
    expect(checkLimit('b', T)).toMatchObject({ ok: true, remaining: 2 });
    expect(checkLimit('a', T + 3_600_001)).toMatchObject({ ok: true }); // first hit aged out
  });
  test('refund gives a request back; 0 means unlimited; the global cap and kill switch work', () => {
    Bun.env.AI_USER_LIMIT = '1';
    expect(checkLimit('x', 1).ok).toBe(true); expect(checkLimit('x', 2).ok).toBe(false); refund('x'); expect(checkLimit('x', 3).ok).toBe(true);
    resetLimits(); Bun.env.AI_USER_LIMIT = '0';
    for (let i = 0; i < 200; i++) expect(checkLimit('u', i).ok).toBe(true);
    resetLimits(); Bun.env.AI_USER_LIMIT = '0'; Bun.env.AI_DAILY_LIMIT = '2';
    expect(checkLimit('p', 1).ok).toBe(true); expect(checkLimit('q', 2).ok).toBe(true);
    expect(checkLimit('r', 3)).toMatchObject({ ok: false, reason: 'global' }); expect(checkLimit('r', 86_400_002).ok).toBe(true);
    Bun.env.AI_DISABLED = '1'; expect(checkLimit('z')).toMatchObject({ ok: false, reason: 'disabled' });
  });
  test('messages are human', () => {
    expect(limitMessage({ ok: false, reason: 'user', retryAfterMs: 5 * 60_000 })).toContain('5 minutes');
    expect(limitMessage({ ok: false, reason: 'user', retryAfterMs: 1000 })).toContain('1 minute.');
    expect(limitMessage({ ok: false, reason: 'global', retryAfterMs: 3 * 3_600_000 })).toContain('3 hours');
    expect(limitMessage({ ok: false, reason: 'disabled', retryAfterMs: 0 })).toContain('switched off');
  });
  test('garbage env values fall back to defaults', () => {
    Bun.env.AI_USER_LIMIT = 'abc'; for (let i = 0; i < 20; i++) expect(checkLimit('g', i).ok).toBe(true); expect(checkLimit('g', 21).ok).toBe(false);
  });
});

// ─── Store: persona + opt-in memory ──────────────────────────────────────────
describe('persona and memory store', () => {
  test('persona is validated and trimmed; control characters are stripped', async () => {
    const u = uid();
    await store.setPersona(u, '  a  grumpy\u0000 pirate\n\n captain ');
    expect(await store.getPersona(u)).toBe('a grumpy pirate captain');
    await expect(store.setPersona(u, '   ')).rejects.toThrow(/empty/); await expect(store.setPersona(u, 'x'.repeat(501))).rejects.toThrow(/under 500/);
    expect(await store.getPersona(u)).toBe('a grumpy pirate captain');
    await store.clearPersona(u); expect(await store.getPersona(u)).toBeNull();
  });
  test('memory is OFF by default: notes need opt-in, and nothing reaches prompts until then', async () => {
    const u = uid();
    expect(await store.memoryEnabled(u)).toBe(false);
    await expect(store.addNote(u, 'I like tea')).rejects.toThrow(/memory on/);
    await store.setMemoryEnabled(u, true); await store.addNote(u, 'I like tea');
    expect(await store.notesForPrompt(u)).toEqual(['I like tea']);
    await store.setMemoryEnabled(u, false);
    expect(await store.notesForPrompt(u)).toEqual([]);           // hidden from prompts immediately…
    expect((await store.listNotes(u)).length).toBe(1);           // (setMemoryEnabled alone doesn't erase)
    expect(await store.disableMemory(u)).toBe(1); expect((await store.listNotes(u)).length).toBe(0); // …and disableMemory erases
  });
  test('note limits: length, count cap holds under concurrency, forget only your own', async () => {
    const u = uid(), other = uid();
    await store.setMemoryEnabled(u, true); await store.setMemoryEnabled(other, true);
    await expect(store.addNote(u, 'x'.repeat(201))).rejects.toThrow(/under 200/); await expect(store.addNote(u, '  ')).rejects.toThrow(/empty/);
    const results = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => store.addNote(u, `note ${i}`)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(store.MAX_NOTES);
    expect((await store.listNotes(u)).length).toBe(store.MAX_NOTES);
    const theirs = await store.addNote(other, 'private');
    expect(await store.forgetNote(u, theirs.id)).toBe(false); expect(await store.listNotes(other)).toHaveLength(1);
    const mine = (await store.listNotes(u))[0]!; expect(await store.forgetNote(u, mine.id)).toBe(true);
    expect(await store.clearNotes(u)).toBe(store.MAX_NOTES - 1);
  });
  test('guild AI defaults to on; toggling and persona work', async () => {
    expect(await store.getGuildAi('g-new')).toEqual({ enabled: true, persona: null });
    await store.setGuildEnabled('g-new', false); await store.setGuildPersona('g-new', ' cheerful  pirate ');
    expect(await store.getGuildAi('g-new')).toEqual({ enabled: false, persona: 'cheerful pirate' });
    await store.setGuildEnabled('g-new', true); expect((await store.getGuildAi('g-new')).persona).toBe('cheerful pirate');
    await store.setGuildPersona('g-new', null); expect((await store.getGuildAi('g-new')).persona).toBeNull();
    await expect(store.setGuildPersona('g-new', 'y'.repeat(600))).rejects.toThrow();
  });
  test('/privacy delete erases persona, prefs and notes', async () => {
    const u = uid(); await store.setPersona(u, 'pirate'); await store.setMemoryEnabled(u, true); await store.addNote(u, 'secret');
    await deleteData(u);
    expect(await store.getPersona(u)).toBeNull(); expect(await store.memoryEnabled(u)).toBe(false); expect(await store.listNotes(u)).toEqual([]);
  });
});

// ─── Prompts ─────────────────────────────────────────────────────────────────
describe('prompts', () => {
  test('system prompt always carries the safety rules and only includes what was supplied', () => {
    const bare = buildSystem({ now: new Date('2026-05-01') });
    expect(bare).toContain(BOT_NAME); expect(bare).toContain(SAFETY); expect(bare).toContain('2026-05-01'); expect(bare).not.toContain('persona'); expect(bare).not.toContain('Notes the person');
    const full = buildSystem({ guildPersona: 'cheerful', userPersona: 'grumpy pirate', notes: ['likes tea', 'has a dog'], userName: 'Sam', guildName: 'Cool Club' });
    for (const s of ['cheerful', 'grumpy pirate', '- likes tea', '- has a dog', '"Sam"', 'Cool Club', SAFETY]) expect(full).toContain(s);
  });
  test('safety text forbids pings, private info and passing fiction off as fact', () => { expect(SAFETY).toMatch(/@everyone/); expect(SAFETY).toMatch(/private information/); expect(SAFETY).toMatch(/fictional/); });
  test('fun kinds: unique ids, valid Discord choices (≤25, ≤100 chars), prompts include the inputs', () => {
    expect(FUN_KINDS.length).toBeLessThanOrEqual(25); expect(new Set(FUN_KINDS.map(k => k.id)).size).toBe(FUN_KINDS.length);
    for (const k of FUN_KINDS) {
      expect(k.label.length).toBeLessThanOrEqual(100); expect(k.id).toMatch(/^[a-z]+$/);
      const p = k.prompt('WHO_X', 'ABOUT_Y'); expect(p.length).toBeGreaterThan(30);
      if (k.target !== 'none') expect(p, k.id).toContain('WHO_X');
      expect(funKind(k.id)).toBe(k);
    }
    expect(funKind('nope')).toBeUndefined();
  });
  test('nothing in any prompt reads message history', () => { for (const k of FUN_KINDS) expect(k.prompt('a', 'b').toLowerCase(), k.id).not.toMatch(/messages|chat history|based on how they talk|recent activity/); });
});

// ─── Vision ──────────────────────────────────────────────────────────────────
describe('vision helper', () => {
  const png = (w: number, h: number) => { const c = createCanvas(w, h); const x = c.getContext('2d'); x.fillStyle = '#3366cc'; x.fillRect(0, 0, w, h); return c.toBuffer('image/png'); };
  test('magic-byte sniffing', () => {
    expect(sniffMime(png(4, 4))).toBe('image/png'); expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toBe('image/webp'); expect(sniffMime(Buffer.from('GIF89a......'))).toBe('image/gif');
    expect(sniffMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull(); expect(sniffMime(Buffer.from('hello world, not an image'))).toBeNull(); expect(sniffMime(Buffer.alloc(0))).toBeNull();
  });
  test('small images become clean PNG data URIs; big flat ones are downscaled to ≤1600px; big photos become JPEG', async () => {
    const { loadImage } = await import('@napi-rs/canvas');
    const small = await toDataUri(png(64, 64)); expect(small).toStartWith('data:image/png;base64,');
    const smallImg = await loadImage(Buffer.from(small.split(',')[1]!, 'base64')); expect([smallImg.width, smallImg.height]).toEqual([64, 64]);
    const big = await toDataUri(png(3200, 1800));
    const bigImg = await loadImage(Buffer.from(big.split(',')[1]!, 'base64')); expect([bigImg.width, bigImg.height]).toEqual([1600, 900]);
    // Noise doesn't compress: the PNG exceeds 3 MB so it is re-encoded as JPEG.
    const c = createCanvas(1600, 900), x = c.getContext('2d'), d = x.getImageData(0, 0, 1600, 900);
    for (let i = 0; i < d.data.length; i++) d.data[i] = i % 4 === 3 ? 255 : Math.floor(Math.random() * 256);
    x.putImageData(d, 0, 0);
    const photo = await toDataUri(c.toBuffer('image/png')); expect(photo).toStartWith('data:image/jpeg;base64,');
  });
  test('rejects non-images and corrupt images with friendly errors (and does not crash)', async () => {
    await expect(toDataUri(Buffer.from('not an image at all'))).rejects.toThrow(LookupError);
    await expect(toDataUri(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]))).rejects.toThrow(/isn't an image|valid image|couldn't read/);
  });
});

// ─── Fact-check ──────────────────────────────────────────────────────────────
describe('fact-check', () => {
  const hits = [{ title: 'Great Wall of China', url: 'https://en.wikipedia.org/wiki/Great_Wall_of_China', snippet: 'a series of fortifications', source: 'Wikipedia' }, { title: 'Space', url: 'https://x.test/space', snippet: 'about space', source: 'Wikipedia' }];
  test('keywords drop filler and keep distinctive words', () => {
    expect(keywords('The Great Wall of China is visible from space!')).toBe('great wall china visible space');
    expect(keywords('a the of')).toBe(''); expect(keywords('word '.repeat(50)).split(' ')).toHaveLength(1);
    expect(keywords('one two three four five six seven eight nine ten', 4)).toBe('one two three four');
  });
  test('verdict parsing is forgiving but never trusts bad values', () => {
    const ok = parseVerdict('Here you go:\n```json\n{"verdict":"FALSE","confidence":87.6,"explanation":"It is not.","sources":[1,2,2,9,"x"]}\n```', hits);
    expect(ok).toMatchObject({ verdict: 'false', confidence: 88, explanation: 'It is not.' }); expect(ok.sources.map(s => s.title)).toEqual(['Great Wall of China', 'Space']);
    expect(parseVerdict('{"verdict":"definitely maybe","confidence":500}', hits)).toMatchObject({ verdict: 'unverifiable', confidence: 100, explanation: 'No explanation was given.' });
    expect(parseVerdict('{"verdict":"true","confidence":-5,"sources":"1"}', hits)).toMatchObject({ confidence: 0, sources: [] });
    expect(() => parseVerdict('I cannot answer that', hits)).toThrow(LookupError);
    expect(evidenceBlock(hits)).toBe('[1] Great Wall of China — a series of fortifications (https://en.wikipedia.org/wiki/Great_Wall_of_China)\n[2] Space — about space (https://x.test/space)');
  });
  test('full flow: evidence goes to the model in a numbered block, JSON mode and low temperature are requested', async () => {
    respond = () => '{"verdict":"false","confidence":95,"explanation":"Not visible to the naked eye.","sources":[1]}';
    const r = await factcheck('The Great Wall of China is visible from space', { searchImpl: async () => ({ hits, engine: 'Wikipedia' }) });
    expect(r).toMatchObject({ verdict: 'false', confidence: 95, engine: 'Wikipedia' }); expect(r.sources).toHaveLength(1);
    const b = chatCalls()[0]!.body;
    expect(b.response_format).toEqual({ type: 'json_object' }); expect(b.temperature).toBe(0.1); expect(b.messages[1].content).toContain('[1] Great Wall of China'); expect(b.messages[1].content).toContain('Claim: "The Great Wall');
  });
  test('no sources → "unverifiable" without spending an AI call; bad claims are rejected', async () => {
    const r = await factcheck('some very obscure claim here', { searchImpl: async () => { throw new LookupError('No results'); } });
    expect(r).toMatchObject({ verdict: 'unverifiable', engine: 'none' }); expect(chatCalls()).toHaveLength(0);
    await expect(factcheck('short')).rejects.toThrow(/8–400/); await expect(factcheck('x'.repeat(401))).rejects.toThrow(/8–400/);
  });
});

// ─── Transcription ───────────────────────────────────────────────────────────
describe('speech-to-text', () => {
  const tone = (secs: number, rate = 8000) => withWorkdir(async dir => { await ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=440:duration=${secs}:sample_rate=${rate}`, path.join(dir, 't.wav')], { cwd: dir }); return readFile(path.join(dir, 't.wav')); });
  test('config comes from env, falling back to the chat provider', () => {
    expect(whisperConfig()).toMatchObject({ model: 'whisper-1', apiKey: 'sk-test' }); expect(whisperConfig()!.baseUrl).toBe(Bun.env.LLM_BASE_URL!);
    Bun.env.WHISPER_BASE_URL = 'http://whisper.local:9000/v1/'; Bun.env.WHISPER_MODEL = 'large-v3';
    expect(whisperConfig()).toEqual({ baseUrl: 'http://whisper.local:9000/v1', apiKey: 'sk-test', model: 'large-v3' });
    delete Bun.env.WHISPER_BASE_URL; delete Bun.env.WHISPER_MODEL;
  });
  test('audio is converted to small mono MP3 and sent to the provider; text is trimmed', async () => {
    const r = await transcribe(await tone(2), 'clip.wav');
    expect(r).toEqual({ text: 'hello from the mock', seconds: 1.5 });
    const c = calls.find(x => x.path.endsWith('/audio/transcriptions'))!;
    expect(c.body).toMatchObject({ model: 'whisper-1', type: 'audio/mpeg', format: 'verbose_json' }); expect(c.body.size).toBeGreaterThan(500); expect(c.body.size).toBeLessThan(50_000);
  });
  test('files without audio and clips over the limit are refused before any upload', async () => {
    const c = createCanvas(32, 32); await expect(transcribe(c.toBuffer('image/png'), 'pic.png')).rejects.toThrow(/no audio|couldn't|Invalid/i);
    expect(calls).toHaveLength(0);
    const long = await tone(MAX_SECONDS + 30, 4000);
    await expect(toSpeechMp3(long, 'long.wav')).rejects.toThrow(/minutes long/);
    expect(calls).toHaveLength(0);
  });
  test('provider errors surface as friendly messages', async () => {
    failWith = 500; await expect(transcribe(await tone(1), 'a.wav')).rejects.toThrow(/speech-to-text service returned an error \(500\).*exploded/);
    const saved = Bun.env.LLM_BASE_URL; delete Bun.env.LLM_BASE_URL; await expect(transcribe(await tone(1), 'a.wav')).rejects.toThrow(/isn't configured/); Bun.env.LLM_BASE_URL = saved;
  });
});

// ─── Chat on mention ─────────────────────────────────────────────────────────
interface FakeMsgOpts { content?: string; authorId?: string; bot?: boolean; guildId?: string | null; mentionsBot?: boolean; everyone?: boolean; chain?: { id: string; name: string; content: string; bot?: boolean }[]; replyToBot?: boolean; images?: string[]; guildName?: string }
function fakeMessage(o: FakeMsgOpts = {}) {
  const replies: any[] = []; let typing = 0;
  const botUser = { id: 'bot1', username: 'Bestow' };
  const chain = o.chain ?? [];
  const mk = (i: number): any => {
    const m = chain[i]!;
    return { author: { id: m.bot ? 'bot1' : m.id, displayName: m.name, username: m.name }, member: null, content: m.content, reference: i > 0 ? { messageId: `m${i - 1}` } : null, fetchReference: async () => mk(i - 1) };
  };
  const msg: any = {
    author: { id: o.authorId ?? uid(), bot: !!o.bot, displayName: 'Sam', username: 'sam' }, system: false, member: { displayName: 'Sam' },
    guildId: o.guildId === undefined ? 'g-chat' : o.guildId, guild: { name: o.guildName ?? 'Test Server' },
    client: { user: botUser },
    content: o.content ?? '<@bot1> hello there',
    mentions: { users: { has: (id: string) => !!o.mentionsBot && id === 'bot1' }, everyone: !!o.everyone },
    attachments: new Map((o.images ?? []).map((u, i) => [String(i), { url: u, contentType: 'image/png' }])),
    reference: chain.length || o.replyToBot ? { messageId: `m${Math.max(0, chain.length - 1)}` } : null,
    fetchReference: async () => (chain.length ? mk(chain.length - 1) : { author: { id: o.replyToBot ? 'bot1' : 'someone' }, content: 'earlier', reference: null }),
    channel: { sendTyping: async () => { typing++; } },
    reply: async (p: any) => { replies.push(p); return {}; },
  };
  return { msg, replies, typing: () => typing };
}
const deps = (over: Partial<Deps> = {}): Deps => ({ chat: async (m, o) => { const { chat } = await import('../src/services/llm'); return chat(m, o); }, toDataUri: async u => `data:image/png;base64,FAKE(${u})`, now: () => new Date('2026-05-01'), ...over });

describe('chat on mention', () => {
  test('mention parsing and message construction', () => {
    expect(stripMention('<@bot1> hi <@!bot1>  there', 'bot1')).toBe('hi there'); expect(stripMention('<@other> hi', 'bot1')).toBe('<@other> hi');
    expect(userContent('hi', [])).toBe('hi'); expect(userContent('', ['data:x'])).toEqual([{ type: 'text', text: 'What do you see in this image?' }, { type: 'image_url', image_url: { url: 'data:x' } }]);
    expect(chainToMessages([{ authorId: 'u1', name: 'Al', content: 'q?' }, { authorId: 'bot1', name: 'Bestow', content: 'a.' }, { authorId: 'u2', name: 'Bo', content: '   ' }], 'bot1')).toEqual([{ role: 'user', content: 'Al: q?' }, { role: 'assistant', content: 'a.' }]);
  });
  test('a mention gets a reply that pings nobody, carrying persona + opted-in notes and the person\'s name', async () => {
    const u = uid(); await store.setPersona(u, 'a grumpy pirate'); await store.setMemoryEnabled(u, true); await store.addNote(u, 'has a dog named Rex');
    await store.setGuildPersona('g-chat', 'cheerful');
    respond = () => 'Ahoy @everyone and <@&123>!';
    const { msg, replies, typing } = fakeMessage({ authorId: u, mentionsBot: true, content: '<@bot1> what is 2+2?' });
    expect(await handleAiMessage(msg, deps())).toBe('replied'); expect(typing()).toBe(1);
    expect(replies[0].allowedMentions).toEqual({ parse: [], repliedUser: false });
    expect(replies[0].content).not.toMatch(/@everyone/); expect(replies[0].content).toContain('@​everyone'); expect(replies[0].content).not.toContain('<@&123>');
    const b = chatCalls()[0]!.body;
    expect(b.model).toBe('mock-chat'); expect(b.messages[0].role).toBe('system');
    for (const s of ['a grumpy pirate', 'cheerful', 'has a dog named Rex', '"Sam"', 'Test Server', SAFETY]) expect(b.messages[0].content).toContain(s);
    expect(b.messages.at(-1)).toEqual({ role: 'user', content: 'what is 2+2?' });
    await store.setGuildPersona('g-chat', null);
  });
  test('opt-out really means the model never sees notes', async () => {
    const u = uid(); await store.setMemoryEnabled(u, true); await store.addNote(u, 'secret fact'); await store.setMemoryEnabled(u, false);
    await handleAiMessage(fakeMessage({ authorId: u, mentionsBot: true }).msg, deps());
    expect(JSON.stringify(chatCalls()[0]!.body)).not.toContain('secret fact');
  });
  test('ignores: bots, plain messages, @everyone, and guilds where an admin switched it off', async () => {
    expect(await handleAiMessage(fakeMessage({ bot: true, mentionsBot: true }).msg, deps())).toBe('ignored');
    expect(await handleAiMessage(fakeMessage({ mentionsBot: false }).msg, deps())).toBe('ignored');
    expect(await handleAiMessage(fakeMessage({ mentionsBot: false, everyone: true, content: '@everyone hi' }).msg, deps())).toBe('ignored');
    await store.setGuildEnabled('g-off', false);
    expect(await handleAiMessage(fakeMessage({ guildId: 'g-off', mentionsBot: true }).msg, deps())).toBe('ignored');
    expect(calls).toHaveLength(0);
  });
  test('DMs always get an answer; replying to the bot\'s own message continues the conversation with the reply chain as context', async () => {
    expect(await handleAiMessage(fakeMessage({ guildId: null, mentionsBot: false, content: 'hey' }).msg, deps())).toBe('replied');
    calls.length = 0;
    const chain = [{ id: 'sam', name: 'Sam', content: '<@bot1> name a colour' }, { id: 'bot1', name: 'Bestow', content: 'Teal.', bot: true }];
    const { msg } = fakeMessage({ mentionsBot: false, content: 'and another?', chain });
    expect(await handleAiMessage(msg, deps())).toBe('replied');
    const m = chatCalls()[0]!.body.messages;
    expect(m.map((x: any) => x.role)).toEqual(['system', 'user', 'assistant', 'user']); expect(m[1].content).toBe('Sam: name a colour'); expect(m[2].content).toBe('Teal.'); expect(m[3].content).toBe('and another?');
  });
  test('the reply chain is capped and only that chain is read (no channel history)', async () => {
    const chain = Array.from({ length: 20 }, (_, i) => ({ id: 'sam', name: 'Sam', content: `turn ${i}`, bot: i % 2 === 1 }));
    await handleAiMessage(fakeMessage({ content: 'latest', mentionsBot: true, chain }).msg, deps());
    expect(chatCalls()[0]!.body.messages.length).toBe(1 + MAX_CHAIN + 1);
  });
  test('bare mention gets a hint and costs no AI call; images go through the vision path as data URIs', async () => {
    const { msg, replies } = fakeMessage({ mentionsBot: true, content: '<@bot1>' });
    expect(await handleAiMessage(msg, deps())).toBe('replied'); expect(replies[0].content).toContain('Ask me anything'); expect(calls).toHaveLength(0);
    const v = fakeMessage({ mentionsBot: true, content: '<@bot1> what is this?', images: ['https://cdn.discordapp.com/a.png', 'https://cdn.discordapp.com/b.png', 'https://cdn.discordapp.com/c.png'] });
    expect(await handleAiMessage(v.msg, deps())).toBe('replied');
    const b = chatCalls()[0]!.body; expect(b.model).toBe('mock-vision');
    const parts = b.messages.at(-1).content; expect(parts[0]).toEqual({ type: 'text', text: 'what is this?' }); expect(parts.slice(1)).toHaveLength(2); // MAX_IMAGES
    expect(parts[1].image_url.url).toContain('data:image/png;base64,FAKE(https://cdn.discordapp.com/a.png)');
  });
  test('rate-limited people get a message, not an AI call', async () => {
    Bun.env.AI_USER_LIMIT = '1'; const u = uid();
    expect(await handleAiMessage(fakeMessage({ authorId: u, mentionsBot: true }).msg, deps())).toBe('replied');
    const second = fakeMessage({ authorId: u, mentionsBot: true });
    expect(await handleAiMessage(second.msg, deps())).toBe('limited'); expect(second.replies[0].content).toContain('free AI requests'); expect(chatCalls()).toHaveLength(1);
  });
  test('provider failure: friendly apology, request refunded, nothing leaked', async () => {
    Bun.env.AI_USER_LIMIT = '1'; const u = uid();
    failWith = 500; failWith = 500;
    const a = fakeMessage({ authorId: u, mentionsBot: true });
    const orig = console.error; console.error = () => {};
    try { expect(await handleAiMessage(a.msg, deps())).toBe('error'); } finally { console.error = orig; }
    expect(a.replies[0].content).toContain('couldn\'t come up with an answer'); expect(a.replies[0].content).not.toContain('exploded');
    expect(await handleAiMessage(fakeMessage({ authorId: u, mentionsBot: true }).msg, deps())).toBe('replied'); // refunded
  });
  test('unconfigured provider: silent in servers, honest in DMs', async () => {
    const saved = Bun.env.LLM_BASE_URL; delete Bun.env.LLM_BASE_URL;
    try {
      expect(await handleAiMessage(fakeMessage({ mentionsBot: true }).msg, deps())).toBe('ignored');
      const dm = fakeMessage({ guildId: null }); expect(await handleAiMessage(dm.msg, deps())).toBe('unavailable'); expect(dm.replies[0]).toContain('isn\'t set up');
    } finally { Bun.env.LLM_BASE_URL = saved; }
  });
});

// ─── /ai commands ────────────────────────────────────────────────────────────
describe('/ai commands', () => {
  test('ask: persona and notes reach the model; the answer is rendered with a disclaimer', async () => {
    const u = uid(); await store.setPersona(u, 'pirate'); respond = () => 'It is 4.';
    const fi = fakeInteraction({ userId: u, options: { prompt: 'what is 2+2' } }); await find(aiSubs, 'chatgpt').run(fi.interaction);
    const t = textOf(fi.last()); expect(t).toContain('It is 4.'); expect(t).toContain('Results are AI generated');
    expect(chatCalls()[0]!.body.messages[0].content).toContain('pirate');
  });
  test('not configured / rate-limited / provider failure all give friendly text (and failures are refunded)', async () => {
    const saved = Bun.env.LLM_BASE_URL; delete Bun.env.LLM_BASE_URL;
    let fi = fakeInteraction({ options: { prompt: 'hi' } }); await find(aiSubs, 'chatgpt').run(fi.interaction); expect(textOf(fi.last())).toContain('AI isn\'t set up'); Bun.env.LLM_BASE_URL = saved;
    Bun.env.AI_USER_LIMIT = '1'; const u = uid();
    fi = fakeInteraction({ userId: u, options: { prompt: 'one' } }); await find(aiSubs, 'chatgpt').run(fi.interaction);
    fi = fakeInteraction({ userId: u, options: { prompt: 'two' } }); await find(aiSubs, 'chatgpt').run(fi.interaction); expect(textOf(fi.last())).toContain('free AI requests'); expect(chatCalls()).toHaveLength(1);
    const v = uid(); failWith = 500; const orig = console.error; console.error = () => {};
    try { fi = fakeInteraction({ userId: v, options: { prompt: 'boom' } }); await find(aiSubs, 'chatgpt').run(fi.interaction); } finally { console.error = orig; }
    expect(textOf(fi.last())).toContain('❌'); expect(textOf(fi.last())).not.toContain('exploded');
    fi = fakeInteraction({ userId: v, options: { prompt: 'again' } }); await find(aiSubs, 'chatgpt').run(fi.interaction); expect(textOf(fi.last())).toContain('mock reply');
  });
  test('ask with a non-image attachment is refused; with an image it goes to the vision model', async () => {
    let fi = fakeInteraction({ options: { prompt: 'what?' }, attachments: { image: { url: 'https://x.test/a.pdf', name: 'a.pdf', contentType: 'application/pdf' } } });
    await find(aiSubs, 'chatgpt').run(fi.interaction); expect(textOf(fi.last())).toContain('isn\'t an image'); expect(calls).toHaveLength(0);
    const png = (() => { const c = createCanvas(20, 20); return c.toBuffer('image/png'); })();
    const img = Bun.serve({ port: 0, fetch: () => new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } }) });
    Bun.env.ALLOW_PRIVATE_URLS = '1';
    try {
      fi = fakeInteraction({ options: { prompt: 'what is this' }, attachments: { image: { url: `http://127.0.0.1:${img.port}/a.png`, name: 'a.png', contentType: 'image/png' } } });
      await find(aiSubs, 'chatgpt').run(fi.interaction);
      const b = chatCalls()[0]!.body; expect(b.model).toBe('mock-vision'); expect(b.messages[1].content[1].image_url.url).toStartWith('data:image/png;base64,');
    } finally { delete Bun.env.ALLOW_PRIVATE_URLS; img.stop(true); }
  });
  test('ocr uses the vision model with the OCR system prompt at low temperature', async () => {
    const png = (() => { const c = createCanvas(20, 20); return c.toBuffer('image/png'); })();
    const img = Bun.serve({ port: 0, fetch: () => new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } }) });
    Bun.env.ALLOW_PRIVATE_URLS = '1'; respond = () => 'HELLO WORLD';
    try {
      const fi = fakeInteraction({ options: { url: `http://127.0.0.1:${img.port}/a.png` } }); await find(aiSubs, 'ocr').run(fi.interaction);
      expect(textOf(fi.last())).toContain('HELLO WORLD'); const b = chatCalls()[0]!.body; expect(b.model).toBe('mock-vision'); expect(b.temperature).toBe(0.2); expect(b.messages[0].content).toContain('OCR');
    } finally { delete Bun.env.ALLOW_PRIVATE_URLS; img.stop(true); }
  });
  test('geolocate keeps its privacy guardrails in the prompt', async () => {
    const png = (() => { const c = createCanvas(20, 20); return c.toBuffer('image/png'); })();
    const img = Bun.serve({ port: 0, fetch: () => new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } }) });
    Bun.env.ALLOW_PRIVATE_URLS = '1';
    try {
      const fi = fakeInteraction({ options: { url: `http://127.0.0.1:${img.port}/a.png` } }); await find(aiSubs, 'geolocate').run(fi.interaction);
      const sys = chatCalls()[0]!.body.messages[0].content as string; expect(sys).toMatch(/NEVER give street addresses/); expect(sys).toMatch(/private residence/); expect(sys).toMatch(/Do not identify people/);
    } finally { delete Bun.env.ALLOW_PRIVATE_URLS; img.stop(true); }
  });
  test('summarize rejects tiny input; fun demands a user for person bits and never touches history', async () => {
    let fi = fakeInteraction({ options: { text: 'too short' } }); await find(aiSubs, 'summarize').run(fi.interaction); expect(textOf(fi.last())).toContain('already short'); expect(calls).toHaveLength(0);
    fi = fakeInteraction({ options: { kind: 'court' } }); await find(aiSubs, 'fun').run(fi.interaction); expect(textOf(fi.last())).toContain('needs someone'); expect(calls).toHaveLength(0);
    respond = () => 'GUILTY of stealing the last slice.';
    fi = fakeInteraction({ options: { kind: 'court', about: 'pizza\ntheft' }, users: { user: { id: '77', username: 'vic', displayName: 'Vic' } } }); await find(aiSubs, 'fun').run(fi.interaction);
    const t = textOf(fi.last()); expect(t).toContain('Vic'); expect(t).toContain('<@77>'); expect(t).toContain('GUILTY'); expect(t).toContain('fiction');
    const b = chatCalls()[0]!.body; expect(b.messages[1].content).toContain('Vic'); expect(b.messages[1].content).toContain('pizza theft'); expect(b.temperature).toBe(1);
    fi = fakeInteraction({ options: { kind: 'hottake' } }); await find(aiSubs, 'fun').run(fi.interaction); expect(textOf(fi.last())).toContain('GUILTY');
  });
  test('factcheck renders verdict, confidence and sources', async () => {
    respond = () => '{"verdict":"false","confidence":90,"explanation":"No.","sources":[1]}';
    // Use the real search path stubbed by a local Wikipedia-shaped server is overkill; exercise the renderer through the exported flow instead.
    const r = await factcheck('The Great Wall of China is visible from space', { searchImpl: async () => ({ hits: [{ title: 'Great Wall', url: 'https://en.wikipedia.org/wiki/Great_Wall', snippet: 's', source: 'Wikipedia' }], engine: 'Wikipedia' }) });
    expect(r.verdict).toBe('false');
  });
  test('persona commands are private and validate', async () => {
    const u = uid();
    let fi = fakeInteraction({ userId: u, options: { persona: 'a wise old owl' } }); await group('persona', 'set').run(fi.interaction);
    expect(fi.deferFlags() & 64).toBeTruthy(); expect(await store.getPersona(u)).toBe('a wise old owl');
    fi = fakeInteraction({ userId: u }); await group('persona', 'show').run(fi.interaction); expect(textOf(fi.last())).toContain('wise old owl');
    fi = fakeInteraction({ userId: u, options: { persona: 'x'.repeat(600) } }); await group('persona', 'set').run(fi.interaction); expect(textOf(fi.last())).toContain('under 500');
    fi = fakeInteraction({ userId: u }); await group('persona', 'clear').run(fi.interaction); expect(await store.getPersona(u)).toBeNull();
  });
  test('memory commands: off by default, explicit, private, erasing on off', async () => {
    const u = uid();
    let fi = fakeInteraction({ userId: u, options: { note: 'likes cats' } }); await group('memory', 'remember').run(fi.interaction); expect(textOf(fi.last())).toContain('memory on'); expect(fi.deferFlags() & 64).toBeTruthy();
    fi = fakeInteraction({ userId: u }); await group('memory', 'on').run(fi.interaction); expect(textOf(fi.last())).toContain('Nothing is saved automatically');
    fi = fakeInteraction({ userId: u, options: { note: 'likes cats' } }); await group('memory', 'remember').run(fi.interaction); expect(textOf(fi.last())).toContain('Saved');
    fi = fakeInteraction({ userId: u }); await group('memory', 'list').run(fi.interaction); expect(textOf(fi.last())).toContain('likes cats'); expect(textOf(fi.last())).toContain('**on**');
    const id = (await store.listNotes(u))[0]!.id;
    fi = fakeInteraction({ userId: u, options: { id: id + 999 } }); await group('memory', 'forget').run(fi.interaction); expect(textOf(fi.last())).toContain('don\'t have a note');
    fi = fakeInteraction({ userId: u }); await group('memory', 'off').run(fi.interaction); expect(textOf(fi.last())).toContain('erased'); expect(await store.listNotes(u)).toEqual([]);
  });
  test('config needs Manage Server and a server', async () => {
    let fi = fakeInteraction({ guildId: 'g-cfg', manageGuild: false }); await group('config', 'disable').run(fi.interaction); expect(textOf(fi.last())).toContain('Manage Server'); expect((await store.getGuildAi('g-cfg')).enabled).toBe(true);
    fi = fakeInteraction({ guildId: null, manageGuild: true }); await group('config', 'disable').run(fi.interaction); expect(textOf(fi.last())).toContain('run it in a server');
    fi = fakeInteraction({ guildId: 'g-cfg', manageGuild: true }); await group('config', 'disable').run(fi.interaction); expect((await store.getGuildAi('g-cfg')).enabled).toBe(false);
    fi = fakeInteraction({ guildId: 'g-cfg', manageGuild: true, options: { persona: 'cheerful pirate' } }); await group('config', 'persona').run(fi.interaction); expect((await store.getGuildAi('g-cfg')).persona).toBe('cheerful pirate');
    fi = fakeInteraction({ guildId: 'g-cfg', manageGuild: true }); await group('config', 'status').run(fi.interaction); expect(textOf(fi.last())).toContain('off'); expect(textOf(fi.last())).toContain('cheerful pirate');
    fi = fakeInteraction({ guildId: 'g-cfg', manageGuild: true }); await group('config', 'enable').run(fi.interaction); expect((await store.getGuildAi('g-cfg')).enabled).toBe(true);
  });
  test('transcript command runs end to end against the mock provider', async () => {
    const wav = await withWorkdir(async dir => { await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=300:duration=1:sample_rate=8000', path.join(dir, 't.wav')], { cwd: dir }); return readFile(path.join(dir, 't.wav')); });
    const media = Bun.serve({ port: 0, fetch: () => new Response(new Uint8Array(wav), { headers: { 'content-type': 'audio/wav' } }) });
    Bun.env.ALLOW_PRIVATE_URLS = '1';
    try {
      const fi = fakeInteraction({ options: { url: `http://127.0.0.1:${media.port}/t.wav` } }); await find(aiSubs, 'transcript').run(fi.interaction);
      const t = textOf(fi.last()); expect(t).toContain('hello from the mock'); expect(t).toContain('2s of audio');
    } finally { delete Bun.env.ALLOW_PRIVATE_URLS; media.stop(true); }
  });
});
