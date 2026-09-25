import { describe, expect, test } from 'bun:test';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { MAX_MESSAGES, MAX_TEXT, NOTICE, colorFor, renderChat, renderRip, wrapText } from '../src/generate/render';
import { generateSubs } from '../src/subcommands/fun/generate';
import { fakeInteraction, textOf } from './fakeInteraction';

const dims = async (png: Buffer) => { const i = await loadImage(png); return { w: i.width, h: i.height, img: i }; };
const pixel = async (png: Buffer, x: number, y: number) => { const { w, h, img } = await dims(png); const c = createCanvas(w, h), ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); return [...ctx.getImageData(x, y, 1, 1).data]; };
const find = (n: string) => generateSubs.find(s => s.name === n)!;

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
    expect(wrapText(m, 'abc', 5).join('')).toBe('abc'); // narrower than one glyph: still terminates and loses nothing
    expect(wrapText(m, '   lots   of   space   ', 300)).toEqual(['lots of space']);
  });
  test('never loses characters (property check)', () => {
    for (let n = 0; n < 200; n++) {
      const text = Array.from({ length: 1 + (n % 12) }, (_, i) => 'x'.repeat(1 + ((n * 7 + i * 13) % 25))).join(' ');
      expect(wrapText(m, text, 40 + (n % 9) * 30).join('').replace(/ /g, '')).toBe(text.replace(/ /g, ''));
    }
  });
});

describe('renderChat', () => {
  test('produces a PNG at the requested width, with theme colours and the watermark region drawn', async () => {
    const dark = renderChat([{ name: 'Sam', text: 'hello world', time: 'Today at 3:14 PM' }]);
    expect(dark.subarray(1, 4).toString()).toBe('PNG');
    const d = await dims(dark); expect(d.w).toBe(720); expect(d.h).toBeGreaterThan(60); expect(d.h).toBeLessThan(200);
    expect(await pixel(dark, 700, 20)).toEqual([0x31, 0x33, 0x38, 255]);                       // Discord dark background
    expect(await pixel(renderChat([{ name: 'Sam', text: 'hi' }], { theme: 'light' }), 700, 20)).toEqual([255, 255, 255, 255]);
    // The notice sits bottom-right: that strip must contain non-background pixels.
    const { w, h, img } = d; const c = createCanvas(w, h), ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const strip = ctx.getImageData(w - 260, h - 20, 250, 14).data; let diff = 0; for (let i = 0; i < strip.length; i += 4) if (strip[i] !== 0x31 || strip[i + 1] !== 0x33) diff++;
    expect(diff, NOTICE).toBeGreaterThan(50);
  });
  test('taller for longer text; grouping same-author messages is more compact than alternating', async () => {
    const short = (await dims(renderChat([{ name: 'A', text: 'hi' }]))).h;
    const long = (await dims(renderChat([{ name: 'A', text: 'word '.repeat(120) }]))).h;
    expect(long).toBeGreaterThan(short + 60);
    const same = (await dims(renderChat([{ name: 'A', text: 'one' }, { name: 'A', text: 'two' }, { name: 'A', text: 'three' }]))).h;
    const alt = (await dims(renderChat([{ name: 'A', text: 'one' }, { name: 'B', text: 'two' }, { name: 'A', text: 'three' }]))).h;
    expect(same).toBeLessThan(alt);
  });
  test('replies add a header row; limits: 8 messages, 500 characters each, huge input still renders', async () => {
    const plain = (await dims(renderChat([{ name: 'A', text: 'hi' }]))).h, reply = (await dims(renderChat([{ name: 'A', text: 'hi', replyTo: { name: 'B', text: 'original message that is very long '.repeat(10) } }]))).h;
    expect(reply).toBeGreaterThan(plain);
    const many = await dims(renderChat(Array.from({ length: 30 }, (_, i) => ({ name: `U${i}`, text: `m${i}` }))));
    const eight = await dims(renderChat(Array.from({ length: MAX_MESSAGES }, (_, i) => ({ name: `U${i}`, text: `m${i}` }))));
    expect(many.h).toBe(eight.h);
    const huge = await dims(renderChat([{ name: 'A', text: 'y'.repeat(100_000) }]));
    expect(huge.h).toBeLessThan(MAX_TEXT); // 500 chars of 'y' wrap to a handful of lines
    expect((await dims(renderChat([{ name: 'A'.repeat(500), text: 'ok' }]))).w).toBe(720);
  });
  test('handles emoji, RTL and mixed scripts without throwing', () => {
    for (const text of ['party 🎉🔥 time', 'مرحبا بالعالم', '日本語のテキスト', 'á̂̃ zalgo', '​', '<@123> @everyone :smile:']) expect(renderChat([{ name: 'Sam', text }]).length).toBeGreaterThan(500);
  });
  test('name colours are stable per name and within the palette', () => { expect(colorFor('Sam')).toBe(colorFor('Sam')); expect(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(colorFor)).size).toBeGreaterThan(2); });
});

describe('renderRip', () => {
  test('600×700 PNG with the moon, ground and stone drawn', async () => {
    const png = renderRip({ name: 'Sam', dates: '2020 – 2026', epitaph: 'Gone but not forgotten' });
    const d = await dims(png); expect([d.w, d.h]).toEqual([600, 700]);
    expect((await pixel(png, 300, 400))[0]).toBeGreaterThan(100); // stone is light grey, not sky
    expect((await pixel(png, 300, 690)).slice(0, 3)).toEqual([0x2e, 0x3a, 0x2a]); // ground
  });
  test('long names, no epitaph and an avatar all render', async () => {
    const av = createCanvas(64, 64); const x = av.getContext('2d'); x.fillStyle = '#f00'; x.fillRect(0, 0, 64, 64);
    const img = await loadImage(av.toBuffer('image/png'));
    for (const o of [{ name: 'A very long name that will need wrapping over several lines '.repeat(3) }, { name: 'X', avatar: img, epitaph: 'e'.repeat(300) }, { name: '🎉', dates: '' }]) expect(renderRip(o).length).toBeGreaterThan(1000);
  });
});

describe('/generate commands', () => {
  const u = (id: string, n: string) => ({ id, username: n, displayName: n });
  test('message / reply / convo / rip send a PNG attachment', async () => {
    const cases: [string, Record<string, string | number>, Record<string, ReturnType<typeof u>>, string][] = [
      ['message', { text: 'hello', color: '#ff0000' }, { user: u('1', 'Sam') }, 'message.png'],
      ['reply', { text: 'no', original: 'you up?' }, { user: u('1', 'Sam'), replying_to: u('2', 'Bo') }, 'reply.png'],
      ['convo', { lines: 'hi | hey | sup | not much' }, { user1: u('1', 'Sam'), user2: u('2', 'Bo') }, 'convo.png'],
      ['rip', { epitaph: 'rest easy' }, { user: u('1', 'Sam') }, 'rip.png'],
    ];
    for (const [sub, options, users, file] of cases) {
      const fi = fakeInteraction({ options, users }); await find(sub).run(fi.interaction);
      expect(fi.last().files[0].name, sub).toBe(file); expect((fi.last().files[0].attachment as Buffer).subarray(1, 4).toString()).toBe('PNG');
    }
  });
  test('friendly errors for bad input', async () => {
    let fi = fakeInteraction({ options: { text: 'x', color: 'notacolour' }, users: { user: u('1', 'Sam') } }); await find('message').run(fi.interaction); expect(textOf(fi.last())).toContain('❌');
    fi = fakeInteraction({ options: { lines: Array.from({ length: 9 }, (_, i) => `l${i}`).join(' | ') }, users: { user1: u('1', 'A'), user2: u('2', 'B') } }); await find('convo').run(fi.interaction); expect(textOf(fi.last())).toContain('maximum is 8');
    fi = fakeInteraction({ options: { lines: ' | | ' }, users: { user1: u('1', 'A'), user2: u('2', 'B') } }); await find('convo').run(fi.interaction); expect(textOf(fi.last())).toContain('at least one line');
    fi = fakeInteraction({ options: {} }); await find('rip').run(fi.interaction); expect(textOf(fi.last())).toContain('Pick a user or give a name');
  });
});
