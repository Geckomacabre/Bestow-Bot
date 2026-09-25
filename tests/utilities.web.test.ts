import { describe, expect, test } from 'bun:test';
import { ACTIONS, actionGif, actionText, cleanUrban, lyrics, paginate, paste, parseSearx, parseTweet, parseTweetUrl, parseWikipedia, pickLyrics, search, stripTags, tweet, urban } from '../src/lookups/web';
import { CATEGORIES, applyRate, convertAny, convertCurrency, convertUnits, findUnit, formatAmount, parseConversion, unitsOf } from '../src/lookups/convert';
import { QR_MAX, makeQr, scanQrBuffer } from '../src/lookups/qr';
import { createCanvas } from '@napi-rs/canvas';

const live = Bun.env.RUN_NET_TEST === '1' ? test : test.skip;

describe('unit conversion', () => {
  const near = (v: number, want: number) => expect(v).toBeCloseTo(want, 6);
  test('common conversions are right', () => {
    near(convertUnits(1, 'mi', 'km').result, 1.609344); near(convertUnits(5, 'km', 'mi').result, 3.10685596);
    near(convertUnits(100, 'cm', 'in').result, 39.3700787); near(convertUnits(1, 'lb', 'kg').result, 0.45359237); near(convertUnits(1, 'oz', 'g').result, 28.349523125);
    near(convertUnits(1, 'gal', 'l').result, 3.785411784); near(convertUnits(60, 'mph', 'km/h').result, 96.56064); near(convertUnits(1, 'GiB', 'MB').result, 1073.741824);
    near(convertUnits(1, 'day', 'h').result, 24); near(convertUnits(1, 'acre', 'm2').result, 4046.8564224); near(convertUnits(8, 'bit', 'B').result, 1);
  });
  test('temperature is affine, not proportional', () => {
    near(convertUnits(0, 'c', 'f').result, 32); near(convertUnits(100, 'celsius', 'fahrenheit').result, 212); near(convertUnits(-40, 'f', 'c').result, -40);
    near(convertUnits(0, 'k', 'c').result, -273.15); near(convertUnits(72, '°F', 'K').result, 295.372222);
  });
  test('aliases, case rules and spacing', () => {
    expect(findUnit('Kilometers')?.label).toBe('km'); expect(findUnit('FEET')?.label).toBe('ft'); expect(findUnit('fl oz')?.label).toBe('fl oz'); expect(findUnit('floz')?.label).toBe('fl oz');
    expect(findUnit('MB')?.label).toBe('MB'); expect(findUnit('mb')?.label).toBe('MB'); expect(findUnit('KiB')?.label).toBe('KiB'); expect(findUnit('nope')).toBeUndefined();
    expect(findUnit('m')?.label).toBe('m'); expect(findUnit('min')?.label).toBe('min');
  });
  test('errors: unknown, incompatible, non-finite', () => {
    expect(() => convertUnits(1, 'kg', 'km')).toThrow(/can't convert mass.*length/); expect(() => convertUnits(1, 'zz', 'km')).toThrow(/zz/); expect(() => convertUnits(NaN, 'm', 'km')).toThrow(/number/);
    expect(() => convertUnits(1, 'm', 'q'.repeat(500))).toThrow(/don't know/);
  });
  test('every unit converts to itself and round-trips through its category', () => {
    for (const cat of CATEGORIES) for (const u of unitsOf(cat)) for (const v of unitsOf(cat)) {
      const there = convertUnits(123.456, u, v).result, back = convertUnits(there, v, u).result;
      expect(back, `${u}→${v}`).toBeCloseTo(123.456, 6);
    }
  });
  test('free-text parsing', () => {
    expect(parseConversion('5 km to mi')).toEqual({ value: 5, from: 'km', to: 'mi' }); expect(parseConversion('72f in c')).toEqual({ value: 72, from: 'f', to: 'c' });
    expect(parseConversion('-40 F → C')).toEqual({ value: -40, from: 'F', to: 'C' }); expect(parseConversion('1,5 kg to lb').value).toBe(1.5); expect(parseConversion('100 fl oz to ml')).toEqual({ value: 100, from: 'fl oz', to: 'ml' });
    expect(parseConversion('10 US dollars to euro')).toBeTruthy();
    for (const bad of ['', 'km to mi', '5 km', 'hello world']) expect(() => parseConversion(bad), bad).toThrow(/Try something/);
  });
  test('formatting', () => { expect(formatAmount(3.1068559611866697)).toBe('3.1069'); expect(formatAmount(1234567.891)).toBe('1,234,567.89'); expect(formatAmount(0)).toBe('0'); expect(formatAmount(1e-9)).toMatch(/e-9/); expect(formatAmount(0.000123456)).toBe('0.000123456'); });
  test('currency math via cross rates', () => {
    const rates = { USD: 1, EUR: 0.8, JPY: 150 };
    expect(applyRate(10, 'USD', 'EUR', rates)).toBeCloseTo(8, 9); expect(applyRate(80, 'EUR', 'USD', rates)).toBeCloseTo(100, 9); expect(applyRate(80, 'EUR', 'JPY', rates)).toBeCloseTo(15000, 6);
    expect(() => applyRate(1, 'USD', 'XXX', rates)).toThrow(/XXX/); expect(() => applyRate(1, 'YYY', 'USD', rates)).toThrow(/YYY/);
  });
  test('convertAny rejects nonsense before touching the network', async () => {
    expect((await convertAny('5 km to mi')).text).toContain('3.1069 mi');
    await expect(convertAny('5 blorp to zork')).rejects.toThrow(/don't know how/);
    await expect(convertAny('5 kg to km')).rejects.toThrow(/can't convert/);
  });
  live('live FX rates', async () => {
    const r = await convertCurrency(100, 'usd', 'eur');
    expect(r.result).toBeGreaterThan(50); expect(r.result).toBeLessThan(200);
    expect((await convertAny('10 EUR to USD')).text).toMatch(/USD/);
    await expect(convertCurrency(1, 'zzz', 'usd')).rejects.toThrow(/zzz|ZZZ/);
  }, 30_000);
});

describe('web parsers', () => {
  test('urban markup + lyric picking + pagination', () => {
    expect(cleanUrban('a [word] and [two words]\r\nnext')).toBe('a **word** and **two words**\nnext');
    expect(pickLyrics([{ trackName: 'A', artistName: 'X', plainLyrics: null }, { trackName: 'B', artistName: 'Y', plainLyrics: ' la la ' }])).toMatchObject({ title: 'B', text: 'la la', instrumental: false });
    expect(pickLyrics([{ trackName: 'I', artistName: 'Z', plainLyrics: null, instrumental: true }])).toMatchObject({ instrumental: true, text: '' });
    expect(pickLyrics([])).toBeUndefined();
    const pages = paginate(Array.from({ length: 200 }, (_, i) => `line number ${i}`).join('\n'), 500);
    expect(pages.length).toBeGreaterThan(3); for (const p of pages) expect(p.length).toBeLessThanOrEqual(500);
    expect(pages.join('\n').split('\n')).toHaveLength(200);
    expect(paginate('')).toEqual(['']); expect(paginate('x'.repeat(5000), 100)[0]!.length).toBe(100);
  });
  test('search result parsing strips HTML and entities', () => {
    expect(stripTags('a <span class="x">b</span> &amp; c &#039;d&#039;')).toBe("a b & c 'd'");
    const w = parseWikipedia({ query: { search: [{ title: 'Bun (software)', snippet: '<span>Bun</span> is a JavaScript runtime' }] } });
    expect(w[0]).toEqual({ title: 'Bun (software)', url: 'https://en.wikipedia.org/wiki/Bun_(software)', snippet: 'Bun is a JavaScript runtime', source: 'Wikipedia' });
    expect(parseWikipedia({})).toEqual([]);
    const s = parseSearx({ results: [{ title: '<b>T</b>', url: 'https://a.com', content: 'c' }, { title: 'bad', url: 'javascript:alert(1)' }, { title: 'x', url: 'file:///etc/passwd' }] });
    expect(s).toHaveLength(1); expect(s[0]!.title).toBe('T');
  });
  test('tweet URL parsing accepts common hosts and rejects the rest', () => {
    for (const u of ['https://x.com/jack/status/20', 'twitter.com/jack/status/20?s=1', 'https://mobile.twitter.com/jack/status/20', 'https://fxtwitter.com/jack/status/20', 'https://www.x.com/jack/statuses/20'])
      expect(parseTweetUrl(u), u).toEqual({ user: 'jack', id: '20' });
    for (const bad of ['https://evil.com/jack/status/20', 'https://x.com/jack', 'https://x.com/jack/status/abc', 'https://x.com.evil.com/jack/status/1', 'hello', '']) expect(() => parseTweetUrl(bad), bad).toThrow();
  });
  test('tweet parse keeps only https media', () => {
    const t = parseTweet({ user_name: 'Jack', user_screen_name: 'jack', text: 'hi', likes: 1, retweets: 2, replies: 3, date: 'd', tweetURL: 'https://x.com/jack/status/20', media_extended: [{ type: 'image', url: 'https://pbs.twimg.com/a.jpg' }, { type: 'image', url: 'http://insecure/a.jpg' }] });
    expect(t.media).toEqual([{ type: 'image', url: 'https://pbs.twimg.com/a.jpg' }]); expect(t.handle).toBe('jack');
  });
  test('actions: every verb has text for solo and targeted use', () => {
    expect(Object.keys(ACTIONS).length).toBeLessThanOrEqual(25); // Discord choice limit
    for (const k of Object.keys(ACTIONS)) { expect(actionText(k, 'A', 'B')).toContain('B'); expect(actionText(k, 'A')).toContain('A'); expect(actionText(k, 'A')).not.toContain('{'); }
    expect(actionText('hug', 'Ann', 'Bob')).toBe('Ann hugs Bob'); expect(() => actionText('constructor', 'a')).toThrow(/Unknown/); expect(() => actionText('__proto__', 'a')).toThrow(/Unknown/);
  });
  test('bad inputs fail before any request', async () => {
    await expect(urban('')).rejects.toThrow(/word/); await expect(urban('x'.repeat(200))).rejects.toThrow(/100/);
    await expect(lyrics('a')).rejects.toThrow(/song title/); await expect(paste('  ')).rejects.toThrow(/nothing/); await expect(paste('x'.repeat(200_000))).rejects.toThrow(/too long/);
    await expect(search('')).rejects.toThrow(/search/); await expect(tweet('nope')).rejects.toThrow(/tweet link/); await expect(actionGif('constructor')).rejects.toThrow(/Unknown/);
  });
  live('live: urban, lyrics, search, action, tweet', async () => {
    const u = await urban('rizz'); expect(u.def.definition.length).toBeGreaterThan(5);
    const l = await lyrics('never gonna give you up rick astley'); expect(l.text).toContain('Never gonna');
    const s = await search('bun javascript runtime'); expect(s.hits[0]!.url).toMatch(/^https:\/\//);
    const a = await actionGif('hug'); expect(a.url).toMatch(/nekos\.best.*\.gif$/);
    const t = await tweet('https://x.com/jack/status/20'); expect(t.text).toContain('twttr');
  }, 60_000);
  live('live: paste.rs round trip', async () => {
    const url = await paste(`bestow test ${Date.now()}`); expect(url).toMatch(/^https:\/\/paste\.rs\//);
    expect(await (await fetch(url)).text()).toContain('bestow test');
  }, 30_000);
});

describe('QR codes', () => {
  test('generate → scan round trip for varied payloads', async () => {
    for (const text of ['hello', 'https://example.com/a?b=c&d=e#f', 'WIFI:T:WPA;S:MyNet;P:pass word;;', 'ünïcödé 日本語 🎉', 'x'.repeat(400)]) {
      const png = await makeQr(text);
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect(await scanQrBuffer(png), text.slice(0, 20)).toBe(text);
    }
  });
  test('custom colours (dark on light and inverted) still decode', async () => {
    expect(await scanQrBuffer(await makeQr('colour', { dark: '#1a3d8f', light: '#fff2cc' }))).toBe('colour');
    expect(await scanQrBuffer(await makeQr('inverted', { dark: '#ffffff', light: '#000000' }))).toBe('inverted');
  });
  test('scans a small and a transparent-background code', async () => {
    expect(await scanQrBuffer(await makeQr('tiny', { size: 128 }))).toBe('tiny');
    expect(await scanQrBuffer(await makeQr('transparent', { light: '#00000000' }))).toBe('transparent');
  });
  test('errors: empty/too long input, non-QR image, garbage bytes', async () => {
    await expect(makeQr('   ')).rejects.toThrow(/text or a link/); await expect(makeQr('x'.repeat(QR_MAX + 1))).rejects.toThrow(/too long/);
    const c = createCanvas(300, 300); const ctx = c.getContext('2d'); ctx.fillStyle = '#88a'; ctx.fillRect(0, 0, 300, 300);
    await expect(scanQrBuffer(c.toBuffer('image/png'))).rejects.toThrow(/couldn't find a QR/);
    await expect(scanQrBuffer(Buffer.from('not an image'))).rejects.toThrow(/text or script|couldn't read/);
  });
});
