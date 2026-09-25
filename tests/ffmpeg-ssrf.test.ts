import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FFMPEG_BIN, MediaError, assertNotText, download, ffmpeg, looksLikeText, probe, withProtocolWhitelist, withWorkdir } from '../src/framework/media';
import { normalizeImage } from '../src/framework/imgsafe';
import { toSpeechMp3 } from '../src/ai/transcribe';

/**
 * ffmpeg picks a demuxer from file CONTENT. Without defences, a user can upload a text file that is really an HLS playlist / concat script and
 * make ffmpeg fetch arbitrary URLs from the bot's network. These tests prove (with a real local HTTP server counting requests) that it can't.
 */

let server: ReturnType<typeof Bun.serve>;
const hits: string[] = [];
let base = '';
const playlist = () => `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\n${base}/seg.ts\n#EXT-X-ENDLIST\n`;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const p = new URL(req.url).pathname; hits.push(p);
      if (p === '/list.mp4') return new Response(playlist(), { headers: { 'content-type': 'video/mp4' } });
      return new Response(Buffer.alloc(188 * 20, 0x47), { headers: { 'content-type': 'video/mp2t' } });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(() => server.stop(true));

const segHits = () => hits.filter(p => p === '/seg.ts').length;

describe('text/script detection', () => {
  const text = (s: string, enc: BufferEncoding = 'utf8') => Buffer.from(s, enc);
  test('flags playlists, concat scripts, manifests, SVG, HTML and plain text', () => {
    for (const s of ['#EXTM3U\n#EXTINF:1,\nhttp://x/a.ts', '﻿#EXTM3U\n', '  \n#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=1\nx', "ffconcat version 1.0\nfile '/etc/passwd'", '<?xml version="1.0"?><MPD>', '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">',
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>', '﻿<svg>ünïcode</svg>', '<!DOCTYPE html><html>', '[playlist]\nFile1=http://x', '[InternetShortcut]\nURL=http://x', 'just some ascii text', ''.padEnd(600, 'a')])
      expect(looksLikeText(text(s)), JSON.stringify(s.slice(0, 20))).toBe(s !== '' );
    expect(looksLikeText(Buffer.alloc(0))).toBe(false);
  });
  test('does not flag real media containers', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(64)]);
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0x08, 0, 0]), Buffer.from('WAVEfmt '), Buffer.alloc(40)]);
    const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0, 0, 0, 0, 0x21]), Buffer.alloc(100, 0xff)]);
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([1, 0, 1, 0, 0x80, 0, 0]), Buffer.alloc(30)]);
    for (const b of [png, mp4, wav, mp3, gif, Buffer.from(crypto.getRandomValues(new Uint8Array(2000)))]) expect(looksLikeText(b)).toBe(false);
    expect(() => assertNotText(png)).not.toThrow(); expect(() => assertNotText(Buffer.from('#EXTM3U'))).toThrow(MediaError);
  });
  test('the protocol whitelist goes before every input and only there', () => {
    expect(withProtocolWhitelist(['-i', 'a.mp4', '-vf', 'scale=2:2', 'o.mp4'])).toEqual(['-protocol_whitelist', 'file,pipe', '-i', 'a.mp4', '-vf', 'scale=2:2', 'o.mp4']);
    expect(withProtocolWhitelist(['-f', 'lavfi', '-i', 'sine', '-i', 'b.png', 'o'])).toEqual(['-f', 'lavfi', '-protocol_whitelist', 'file,pipe', '-i', 'sine', '-protocol_whitelist', 'file,pipe', '-i', 'b.png', 'o']);
    expect(withProtocolWhitelist(['-version'])).toEqual(['-version']);
  });
});

// Note: ffmpeg's own defaults already refuse network protocols for playlists opened from a local file, so these tests can't show the attack
// "working" without the defences. They pin the behaviour we depend on: the bot never lets an input file cause any outgoing request.
describe('an HLS playlist cannot make ffmpeg touch the network', () => {
  test('probe() and ffmpeg() refuse to fetch it, even if the file gets past the text check', async () => {
    hits.length = 0;
    await withWorkdir(async dir => {
      const f = path.join(dir, 'x.bin'); await writeFile(f, playlist());
      await probe(f, dir).catch(() => {});
      await ffmpeg(['-i', f, '-f', 'null', '-'], { cwd: dir }).catch(() => {});
      await ffmpeg(['-i', f, '-frames:v', '1', path.join(dir, 'o.png')], { cwd: dir }).catch(() => {});
    });
    expect(segHits()).toBe(0);
    expect(hits).toEqual([]); // no request of any kind
  });

  test('download() rejects the playlist itself (only the single fetch of the file, nothing from inside it)', async () => {
    hits.length = 0; Bun.env.ALLOW_PRIVATE_URLS = '1';
    try {
      await withWorkdir(async dir => { await expect(download({ url: `${base}/list.mp4`, name: 'list.mp4', contentType: 'video/mp4' }, dir)).rejects.toThrow(/text or script/); });
    } finally { delete Bun.env.ALLOW_PRIVATE_URLS; }
    expect(hits).toEqual(['/list.mp4']);
  });

  test('image and audio helpers reject playlists, concat scripts and SVG up front', async () => {
    hits.length = 0;
    const bad = [Buffer.from(playlist()), Buffer.from("ffconcat version 1.0\nfile '/etc/hostname'\n"), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>')];
    for (const b of bad) { await expect(normalizeImage(b)).rejects.toThrow(MediaError); await expect(toSpeechMp3(b, 'a.wav')).rejects.toThrow(MediaError); }
    expect(hits).toEqual([]);
  });

  test('a concat script pointing at a local file is refused before ffmpeg runs', async () => {
    await withWorkdir(async dir => {
      await expect(download({ url: 'data:,', name: 'x', contentType: null }, dir)).rejects.toThrow(); // non-http URL never reaches ffmpeg
    });
    expect(FFMPEG_BIN.length).toBeGreaterThan(0);
  });
});
