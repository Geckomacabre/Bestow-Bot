import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { choiceValue } from '../src/framework/heist';
import { probe } from '../src/framework/media';
import { DISPLAY_FONTS, NOTICE, parseInline, parseReactions, renderMessages, stamp, type Person } from '../src/generate/discord';
import { renderRip, wrapText } from '../src/generate/render';
import { roleColor, TIERS } from '../src/generate/extras';
import { cornerXY } from '../src/generate/aiwatermark';
import { builderPayload, placeUsers } from '../src/generate/tierlist';
import { fakeSubs, generateSubs } from '../src/subcommands/fun/generate';
import { fakeInteraction, textOf } from './fakeInteraction';
import { makeSamples } from './fixtures';

const haveFfmpeg = !!Bun.which('ffmpeg');
const it = haveFfmpeg ? test : test.skip;
let dir = '', base = '', server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  Bun.env.ALLOW_PRIVATE_URLS = '1';
  dir = await mkdtemp(path.join(os.tmpdir(), 'bestow-gen-'));
  if (haveFfmpeg) await makeSamples(dir);
  else await Bun.write(path.join(dir, 'sample.png'), createCanvas(64, 64).toBuffer('image/png'));
  server = Bun.serve({ port: 0, fetch(req) { const f = Bun.file(path.join(dir, new URL(req.url).pathname.slice(1))); return f.size ? new Response(f, { headers: { 'content-type': f.type } }) : new Response('no', { status: 404 }); } });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(() => { delete Bun.env.ALLOW_PRIVATE_URLS; server?.stop(true); });

const user = (id: string, username: string) => ({ id, username, globalName: username, createdAt: new Date('2021-03-05'), displayAvatarURL: () => `${base}/sample.png` }) as never;
const find = (subs: { name: string; run: (i: any) => Promise<unknown> }[], name: string) => subs.find(s => s.name === name)!;
async function run(subs: { name: string; run: (i: any) => Promise<unknown> }[], name: string, o: Parameters<typeof fakeInteraction>[0]) {
  const f = fakeInteraction(o);
  await find(subs, name).run(f.interaction);
  const file = f.last()?.files?.[0];
  return { ...f, name: file?.name as string | undefined, data: file ? Buffer.from(file.attachment) : null };
}
const isPng = (b: Buffer | null) => !!b && b.subarray(1, 4).toString() === 'PNG';
const isGif = (b: Buffer | null) => !!b && b.subarray(0, 3).toString() === 'GIF';

describe('parsing', () => {
  test('timestamps: a bare time is "Today at", anything else is used as written', () => {
    expect(stamp('13:33')).toBe('Today at 13:33');
    expect(stamp('4/7/2026 13:33')).toBe('4/7/2026 13:33');
    expect(stamp(null, new Date('2026-01-01T09:05:00'))).toMatch(/^Today at \d{1,2}:05 (AM|PM)$/);
  });
  test('reactions: "💀:3 😭:3", a bare emoji counts 1', () => {
    expect(parseReactions('💀:3 😭:12 🔥')).toEqual([{ emoji: '💀', count: 3 }, { emoji: '😭', count: 12 }, { emoji: '🔥', count: 1 }]);
    expect(parseReactions('')).toEqual([]);
  });
  test('inline markdown: bold, italic, code and mentions', () => {
    expect(parseInline('a **b** *c* `d` @eve')).toEqual([{ text: 'a ' }, { text: 'b', bold: true }, { text: ' ' }, { text: 'c', italic: true }, { text: ' ' }, { text: 'd', code: true }, { text: ' ' }, { text: '@eve', mention: true }]);
  });
  test('display_font choices keep Heist\'s integer values, including "8Bit" → 8', () => {
    expect(DISPLAY_FONTS.map((n, k) => choiceValue('integer', n, k))).toEqual([0, 1, 2, 3, 4, 5, 8, 7]);
  });
  test('Among Us role colours, tier moves, watermark corners', () => {
    expect(roleColor('Impostor')).toBe('#ff1919'); expect(roleColor('Crewmate')).toBe('#8cf3ff'); expect(roleColor('Engineer')).toBe('#f6b21b');
    const tiers = Object.fromEntries(TIERS.map(([t]) => [t, []])) as never as Record<'S' | 'A' | 'B' | 'C' | 'D' | 'F', string[]>;
    placeUsers(tiers, 'S', ['1', '2']); placeUsers(tiers, 'A', ['2', '3']);
    expect([tiers.S, tiers.A]).toEqual([['1'], ['2', '3']]);
    expect(cornerXY('Top Left', 10)).toEqual(['10', '10']); expect(cornerXY('Bottom Right', 10)).toEqual(['W-w-10', 'H-h-10']);
  });
});

describe('renderers', () => {
  test('a run of messages from one person groups under one header', () => {
    const a: Person = { name: 'Ann' }, b: Person = { name: 'Ben' };
    const h = (png: Buffer) => png.readUInt32BE(20);
    expect(h(renderMessages([{ who: a, text: 'x' }, { who: a, text: 'y' }]))).toBeLessThan(h(renderMessages([{ who: a, text: 'x' }, { who: b, text: 'y' }])));
  });
  test('the tier list builder has a picker per tier and Generate/Reset', () => {
    const tiers = Object.fromEntries(TIERS.map(([t]) => [t, [] as string[]])) as never;
    const p = builderPayload('abc', { owner: 'u', hidden: false, at: 0, tiers, users: new Map() }) as { components: { toJSON(): { components: { components: { custom_id: string; disabled?: boolean }[] }[] } }[] };
    const ids = p.components[0]!.toJSON().components.slice(1).flatMap(r => r.components.map(c => c.custom_id));
    expect(ids).toEqual(['tier:abc:S', 'tier:abc:A', 'tier:abc:B', 'tier:abc:C', 'tier:abc:D', 'tier:abc:F', 'tier:abc:go', 'tier:abc:reset']);
  });
});

const dims = async (png: Buffer) => { const i = await loadImage(png); return { w: i.width, h: i.height, img: i }; };
const pixel = async (png: Buffer, x: number, y: number) => { const { w, h, img } = await dims(png); const c = createCanvas(w, h), ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); return [...ctx.getImageData(x, y, 1, 1).data]; };

describe('wrapText', () => {
  const m = (s: string) => s.length * 10; // every character is 10px wide
  test('wraps on spaces without exceeding the width', () => {
    const lines = wrapText(m, 'the quick brown fox jumps over the lazy dog', 150);
    for (const l of lines) expect(m(l)).toBeLessThanOrEqual(150);
    expect(lines.join(' ')).toBe('the quick brown fox jumps over the lazy dog');
  });
  test('splits words longer than a line, keeps newlines, tolerates empty and tiny widths', () => {
    expect(wrapText(m, 'a'.repeat(35), 100)).toEqual(['a'.repeat(10), 'a'.repeat(10), 'a'.repeat(10), 'aaaaa']);
    expect(wrapText(m, 'one\ntwo\n\nthree', 500)).toEqual(['one', 'two', '', 'three']);
    expect(wrapText(m, '', 100)).toEqual(['']);
    expect(wrapText(m, 'abc', 5).join('')).toBe('abc');
    expect(wrapText(m, '   lots   of   space   ', 300)).toEqual(['lots of space']);
  });
  test('never loses characters (property check)', () => {
    for (let n = 0; n < 200; n++) {
      const text = Array.from({ length: 1 + (n % 12) }, (_, i) => 'x'.repeat(1 + ((n * 7 + i * 13) % 25))).join(' ');
      expect(wrapText(m, text, 40 + (n % 9) * 30).join('').replace(/ /g, '')).toBe(text.replace(/ /g, ''));
    }
  });
});

describe('renderRip', () => {
  test('600×700 PNG with the moon, ground and stone drawn', async () => {
    const png = renderRip({ name: 'Sam', dates: '2020 – 2026', epitaph: 'Gone but not forgotten' });
    const d = await dims(png); expect([d.w, d.h]).toEqual([600, 700]);
    expect((await pixel(png, 300, 400))[0]).toBeGreaterThan(100);
    expect((await pixel(png, 300, 690)).slice(0, 3)).toEqual([0x2e, 0x3a, 0x2a]);
  });
  test('long names, no epitaph and an avatar all render', async () => {
    const av = createCanvas(64, 64); const x = av.getContext('2d'); x.fillStyle = '#f00'; x.fillRect(0, 0, 64, 64);
    const img = await loadImage(av.toBuffer('image/png'));
    for (const o of [{ name: 'A very long name that will need wrapping over several lines '.repeat(3) }, { name: 'X', avatar: img, epitaph: 'e'.repeat(300) }, { name: '🎉', dates: '' }]) expect(renderRip(o).length).toBeGreaterThan(1000);
  });
});

describe('renderMessages robustness', () => {
  const who: Person = { name: 'Sam' };
  test('theme backgrounds, and the notice is drawn bottom-right', async () => {
    const png = renderMessages([{ who, text: 'hello world' }], { theme: 'Ash' });
    expect(await pixel(png, 4, 4)).toEqual([0x32, 0x33, 0x39, 255]);
    expect(await pixel(renderMessages([{ who, text: 'hi' }], { theme: 'Light' }), 4, 4)).toEqual([255, 255, 255, 255]);
    const { w, h, img } = await dims(png), c = createCanvas(w, h), ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const strip = ctx.getImageData(w - 200, h - 16, 190, 12).data; let diff = 0;
    for (let k = 0; k < strip.length; k += 4) if (strip[k] !== 0x32 || strip[k + 1] !== 0x33) diff++;
    expect(diff, NOTICE).toBeGreaterThan(40);
  });
  test('longer text is taller; huge input stays bounded; very long names don\'t widen past the cap', async () => {
    const short = (await dims(renderMessages([{ who, text: 'hi' }]))).h, long = (await dims(renderMessages([{ who, text: 'word '.repeat(120) }]))).h;
    expect(long).toBeGreaterThan(short + 60);
    expect((await dims(renderMessages([{ who, text: 'y'.repeat(100_000) }]))).h).toBeLessThan(2000);
    expect((await dims(renderMessages([{ who: { name: 'A'.repeat(500) }, text: 'ok' }]))).w).toBeLessThanOrEqual(940);
  });
  test('handles emoji, RTL and mixed scripts without throwing', () => {
    for (const text of ['party 🎉🔥 time', 'مرحبا بالعالم', '日本語のテキスト', 'á̂̃ zalgo', '​', '<@123> @everyone :smile:', '**unclosed *markers `']) expect(renderMessages([{ who, text }]).length).toBeGreaterThan(500);
  });
});

describe('/generate commands', () => {
  it('fake message with an image, reactions and a mention highlight; togif gives a GIF', async () => {
    const png = await run(fakeSubs, 'message', { users: { user: user('1', 'gecko') }, attachments: { image: { url: `${base}/sample.png`, name: 'sample.png', contentType: 'image/png' } }, options: { text: 'hi **there**', reactions: '💀:3', mention_highlight: true, display_font: 8, theme: 'Onyx' } });
    expect(png.name).toBe('message.png'); expect(isPng(png.data)).toBe(true);
    const gif = await run(fakeSubs, 'message', { users: { user: user('1', 'gecko') }, options: { text: 'hi', togif: true } });
    expect(gif.name).toBe('message.gif'); expect(isGif(gif.data)).toBe(true);
  }, 30_000);
  it('convo needs each user with their message; reply, report, vc, apply, request and tiktok render', async () => {
    const bad = await run(fakeSubs, 'convo', { users: { user1: user('1', 'a'), user2: user('2', 'b') }, options: { msg1: 'hi' } });
    expect(textOf(bad.last())).toContain('user2');
    const ok = await run(fakeSubs, 'convo', { users: { user1: user('1', 'a'), user2: user('2', 'b') }, options: { msg1: 'hi', msg2: 'yo', theme: 'Light' } });
    expect(isPng(ok.data)).toBe(true);
    for (const [name, o] of [
      ['reply', { users: { reply_user: user('1', 'a'), user: user('2', 'b') }, options: { reply_text: 'first', text: 'second' } }],
      ['report', { users: { user: user('1', 'a') }, options: { message: 'bad message', theme: 'Light' } }],
      ['vc', { users: { user1: user('1', 'a'), user2: user('2', 'b') }, options: { channel: 'chill' } }],
      ['apply', { users: { user: user('1', 'a') }, options: { question: 'why?', answer: 'because', status: 'Rejected', reason: 'no' } }],
      ['request', { users: { user: user('1', 'a') }, options: { age: '5m' } }],
      ['tiktokfollowing', { options: { username: 'someone', timeago: '6d', theme: 'Black' } }],
    ] as const) {
      const r = await run(fakeSubs, name, o as never);
      expect(isPng(r.data), name).toBe(true);
    }
  }, 60_000);
  it('ai-watermark: Gemini on a picture stays a PNG; Sora on a video hops around and keeps the sound', async () => {
    const img = await run(fakeSubs, 'ai-watermark', { attachments: { media: { url: `${base}/sample.png`, name: 'sample.png', contentType: 'image/png' } }, options: { brand: 'Gemini', position: 'Top Left', opacity: 0.6 } });
    expect(img.name).toBe('watermarked.png');
    const vid = await run(fakeSubs, 'ai-watermark', { attachments: { media: { url: `${base}/sample.mp4`, name: 'sample.mp4', contentType: 'video/mp4' } }, options: { brand: 'Sora AI' } });
    expect(vid.name).toBe('watermarked.mp4');
    const p = await probe(await Bun.write(path.join(dir, 'wm.mp4'), vid.data!).then(() => 'wm.mp4'), dir);
    expect(p.hasAudio).toBe(true);
    const moving = await run(fakeSubs, 'ai-watermark', { attachments: { media: { url: `${base}/sample.png`, name: 'sample.png', contentType: 'image/png' } }, options: { brand: 'Sora AI', animate: true } });
    expect(moving.name).toBe('watermarked.gif');
  }, 90_000);
  it('among-us (PNG and animated GIF), rip, spotifylyrics', async () => {
    expect(isPng((await run(generateSubs, 'among-us', { options: { role: 'Impostor', description: 'kill' } })).data)).toBe(true);
    const gif = await run(generateSubs, 'among-us', { options: { role: 'Crewmate', togif: true } });
    expect(gif.name).toBe('among-us.gif');
    const p = await probe(await Bun.write(path.join(dir, 'au.gif'), gif.data!).then(() => 'au.gif'), dir);
    expect(p.animated).toBe(true);
    expect((await run(generateSubs, 'rip', { users: { user: user('1', 'gecko') }, options: { reason: 'juul', togif: true } })).name).toBe('rip.gif');
    expect(isPng((await run(generateSubs, 'spotifylyrics', { options: { text: 'line *one*', text2: 'line two', size: 'Small', background: 'Rust' } })).data)).toBe(true);
  }, 60_000);
  test('tierlist opens a builder (private with hidden)', async () => {
    const f = fakeInteraction({ options: { hidden: true } });
    await find(generateSubs, 'tierlist').run(f.interaction);
    expect(f.sent[0].flags & 64).toBe(64); // ephemeral
  });
});
