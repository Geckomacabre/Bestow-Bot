import { beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { initDb } from '../src/utils/db';
import * as lf from '../src/music/lastfm';
import { fmtMs, parseDzTrack, parseSpTrack, spotifyId } from '../src/music/spotify';
import { parseAudd } from '../src/music/recognize';
import { collage, nowPlayingCard } from '../src/music/render';

beforeAll(async () => { await initDb(); });

describe('Last.fm', () => {
  test('recent tracks: a single track comes back as an object, now-playing has no date', () => {
    const one = lf.parseRecent({ recenttracks: { track: { name: 'Song', artist: { name: 'Band' }, url: 'u', '@attr': { nowplaying: 'true' }, image: [{ '#text': 'https://lastfm.freetls.fastly.net/i/u/300x300/abc.jpg', size: 'extralarge' }] }, '@attr': { total: '42' } } });
    expect(one).toEqual({ total: 42, tracks: [{ name: 'Song', artist: 'Band', album: undefined, image: 'https://lastfm.freetls.fastly.net/i/u/300x300/abc.jpg', url: 'u', nowPlaying: true, date: undefined, loved: false }] });
    const many = lf.parseRecent({ recenttracks: { track: [{ name: 'A', artist: { '#text': 'X' }, url: 'a', date: { uts: '100' }, loved: '1' }, { name: 'B', artist: { '#text': 'Y' }, url: 'b' }] } });
    expect(many.tracks.map(t => [t.name, t.artist, t.date, t.loved])).toEqual([['A', 'X', 100_000, true], ['B', 'Y', undefined, false]]);
    expect(lf.parseRecent({ recenttracks: {} }).tracks).toEqual([]);
  });
  test('the grey-star placeholder counts as no art', () => {
    expect(lf.bestImage([{ '#text': 'https://x/2a96cbd8b46e442fc41c2b86b821562f.png', size: 'large' }])).toBeUndefined();
    expect(lf.bestImage([{ '#text': 'https://x/s.png', size: 'small' }, { '#text': 'https://x/l.png', size: 'large' }])).toBe('https://x/l.png');
  });
  test('top lists and periods', () => {
    expect(lf.parseTop([{ '@attr': { rank: '1' }, name: 'A', playcount: '10', url: 'u', artist: { name: 'Z' } }])).toEqual([{ name: 'A', artist: 'Z', plays: 10, url: 'u', image: undefined, rank: 1 }]);
    expect(lf.parseTop(undefined)).toEqual([]);
    expect(lf.PERIODS['3 months']).toBe('3month'); expect(Object.keys(lf.PERIODS)).toEqual(['overall', '7 days', '1 month', '3 months', '6 months', '12 months']);
  });
  test('API signatures: sorted params + secret, without format', () => {
    const want = createHash('md5').update('api_keykmethodauth.getSessiontokent' + 'secret').digest('hex');
    expect(lf.sign({ method: 'auth.getSession', token: 't', api_key: 'k', format: 'json' }, 'secret')).toBe(want);
  });
  test('taste and track input', () => {
    const a = [{ name: 'A', plays: 10, url: '', rank: 1 }, { name: 'B', plays: 5, url: '', rank: 2 }], b = [{ name: 'b', plays: 50, url: '', rank: 1 }, { name: 'C', plays: 1, url: '', rank: 2 }];
    expect(lf.tasteScore(a, b)).toEqual({ score: 50, shared: [{ name: 'B', a: 5, b: 50 }] });
    expect(lf.splitTrack('Daft Punk - One More Time')).toEqual({ artist: 'Daft Punk', track: 'One More Time' });
    expect(lf.splitTrack('Just A Title')).toEqual({ artist: '', track: 'Just A Title' });
  });
  test('linking, styles and unlinking', async () => {
    await lf.link('lf-u', 'rj', null);
    expect(await lf.linked('lf-u')).toMatchObject({ username: 'rj', session_key: null, np_style: 'default' });
    expect(await lf.setNpStyle('lf-u', 'image', true)).toBe(true);
    expect(await lf.linked('lf-u')).toMatchObject({ np_style: 'image', np_canvas: 1 });
    expect(await lf.unlink('lf-u')).toBe(true); expect(await lf.setNpStyle('lf-u', 'compact', false)).toBe(false);
  });
});

describe('Spotify / Deezer', () => {
  test('ids from links and URIs', () => {
    expect(spotifyId('https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC?si=x', 'track')).toBe('4uLU6hMCjMI75M1A2tKUQC');
    expect(spotifyId('spotify:album:1DFixLWuPkv3KT3TnV35m3', 'album')).toBe('1DFixLWuPkv3KT3TnV35m3'); expect(spotifyId('never gonna', 'track')).toBeNull();
  });
  test('track shapes from both services', () => {
    expect(parseSpTrack({ id: 'i', name: 'N', artists: [{ name: 'A' }], album: { id: 'al', name: 'Al', images: [{ url: 'https://i/1.jpg' }], release_date: '1987' }, external_urls: { spotify: 'https://open.spotify.com/track/i' }, duration_ms: 213_000, explicit: false, external_ids: { isrc: 'GBARL9300135' } }))
      .toMatchObject({ artists: ['A'], image: 'https://i/1.jpg', isrc: 'GBARL9300135', source: 'spotify' });
    expect(parseDzTrack({ id: 1, title: 'T', artist: { name: 'A' }, album: { id: 2, title: 'Al', cover_xl: 'https://c/x.jpg' }, link: 'https://deezer.com/track/1', duration: 61, preview: 'https://p/1.mp3' }))
      .toMatchObject({ durationMs: 61_000, preview: 'https://p/1.mp3', source: 'deezer' });
    expect(fmtMs(213_000)).toBe('3:33');
  });
});

describe('song recognition', () => {
  test('AudD answers', () => {
    expect(parseAudd({ status: 'success', result: { title: 'T', artist: 'A', song_link: 'https://lis.tn/x', spotify: { external_urls: { spotify: 'https://open.spotify.com/track/x' }, album: { images: [{ url: 'https://c/1.jpg' }] } } } }))
      .toMatchObject({ title: 'T', artist: 'A', spotify: 'https://open.spotify.com/track/x', cover: 'https://c/1.jpg' });
    expect(parseAudd({ status: 'success', result: null })).toBeNull();
    expect(() => parseAudd({ status: 'error', error: { error_message: 'bad token' } })).toThrow(/bad token/);
  });
});

describe('renderers', () => {
  test('collage and now-playing card render without any art', async () => {
    const png = await collage(Array.from({ length: 9 }, (_, n) => ({ name: `Album ${n}`, artist: 'Band', plays: n })), 3);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    const card = await nowPlayingCard({ name: 'A very long song title that will not fit on the card at all', artist: 'Band', user: 'rj', nowPlaying: true, plays: 5 });
    expect(card.subarray(1, 4).toString()).toBe('PNG');
  });
});
