import { describe, expect, test } from 'bun:test';
import { countAfter, htmlText, parseCount, type MastoStatus, type StatusGet } from '../src/lookups/fixembed';
import { LookupError } from '../src/lookups/handler';
import { instagramRepost, ogInstagramPost, ogStatusId, type ScriptRunner } from '../src/lookups/instaloader';
import { statsLine, type RepostPost } from '../src/lookups/repost';
import { tiktokIdOf, tiktokRepost, tnktokPost } from '../src/lookups/tiktok';
import { FIXTURES } from './fixembed.fixtures';

const { og, tnk } = FIXTURES;
const OG = 'https://oginstagram.com/api/v1/statuses/';
const TNK = 'https://www.tnktok.com/api/v1/statuses/';

/** A fake fixer: answers the URLs it knows, refuses the rest, and records every request. */
function fixer(answers: Record<string, MastoStatus>): { get: StatusGet; seen: string[] } {
  const seen: string[] = [];
  return { seen, get: async url => { seen.push(url); const a = answers[url]; if (!a) throw new Error(`HTTP 404 for ${url}`); return a; } };
}

describe('reading a Mastodon status', () => {
  test('counts are read the way both fixers print them', () => {
    expect([parseCount('12,345'), parseCount('1.2K'), parseCount('3M'), parseCount('1.5b'), parseCount('0'), parseCount('lots'), parseCount(undefined)])
      .toEqual([12345, 1200, 3_000_000, 1_500_000_000, 0, undefined, undefined]);
    const line = '🖼️ 1 / 6  ▶️ 1,234,567  ❤️ 88,231  💬 6,854';
    expect([countAfter(line, '▶️'), countAfter(line, '❤️'), countAfter(line, '💬'), countAfter(line, '🔁')]).toEqual([1234567, 88231, 6854, undefined]);
    expect(countAfter('▶ 5  ❤ 6', '▶️')).toBe(5); // with or without the emoji's variation selector
  });

  test('HTML becomes plain text, with its line breaks and escaped characters', () => {
    expect(htmlText('<p>a<br>b &amp; <a href="x">@c</a></p><p>d &lt;3</p>')).toBe('a\nb & @c\n\nd <3');
  });
});

describe('/instagram repost asks OGInstagram first', () => {
  test('its ids are the ones OGInstagram gives Discord, so its cache is shared', () => {
    expect(ogStatusId({ kind: 'reel', code: 'CxAbCdEfGhI' })).toBe(og.reelId);
    expect(ogStatusId({ kind: 'p', code: 'DW1nTDiDvnF' })).toBe(og.postId);
    expect(ogStatusId({ kind: 'p', code: 'DW1nTDiDvnF' }, 3)).toBe(og.item3Id);
  });

  test('a reel is one request: the author, the caption, when it was posted, likes, comments and views, and the video', async () => {
    const f = fixer({ [OG + og.reelId]: og.reel });
    const p = (await ogInstagramPost({ kind: 'reel', code: 'CxAbCdEfGhI' }, f.get))!;
    expect(f.seen).toEqual([OG + og.reelId]);
    expect(p.author).toEqual({ name: 'Britney Spears', handle: 'britneyspears', url: 'https://www.instagram.com/britneyspears/', avatar: og.reel.account.avatar });
    expect(p.text).toBe('Dancing\n\nwith @nasa & #friends <3');
    expect(p.createdAt).toBe(Date.parse('2026-04-07T16:48:30Z'));
    expect(p.stats.map(s => s.value)).toEqual([88231, 6854, 1234567]);
    expect(statsLine(p.stats)).toBe('♡ 88.2k · 💬 6.9k · 1.2m views');
    expect(p.media).toEqual([{ type: 'video', url: og.reel.media_attachments[0]!.url, thumb: og.reel.media_attachments[0]!.preview_url! }]);
    expect(p.url).toBe('https://www.instagram.com/p/CxAbCdEfGhI/');
  });

  test('a carousel it leaves items out of (here a video) is asked for item by item, and comes back whole and in order', async () => {
    const answers: Record<string, MastoStatus> = { [OG + og.postId]: og.carousel };
    og.carouselItems.forEach((s, n) => { answers[OG + ogStatusId({ kind: 'p', code: 'DW1nTDiDvnF' }, n + 1)] = s; });
    expect(og.carousel.media_attachments).toHaveLength(4); // what OGInstagram's own answer holds for this six-item post
    const f = fixer(answers);
    const p = (await ogInstagramPost({ kind: 'p', code: 'DW1nTDiDvnF' }, f.get))!;
    expect(f.seen).toHaveLength(7);
    expect(p.media.map(m => m.type)).toEqual(['image', 'image', 'video', 'image', 'image', 'image']);
    expect(p.media.map(m => /\/offload\/DW1nTDiDvnF\/(\d)\?/.exec(m.url)?.[1])).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(p.text).toBe('Hello, Moon.'); expect(p.stats.map(s => s.value)).toEqual([11101714, 46439, undefined]);
  });

  test('if any item can\'t be had, the first answer is kept as it was', async () => {
    const f = fixer({ [OG + og.postId]: og.carousel, [OG + ogStatusId({ kind: 'p', code: 'DW1nTDiDvnF' }, 1)]: og.carouselItems[0]! });
    const p = (await ogInstagramPost({ kind: 'p', code: 'DW1nTDiDvnF' }, f.get))!;
    expect(p.media).toHaveLength(4); expect(p.media.every(m => m.type === 'image')).toBe(true);
  });

  test('a post with no caption, no views and its likes hidden (printed as 0) leaves them off', async () => {
    const p = (await ogInstagramPost({ kind: 'p', code: 'DAbc' }, fixer({ [OG + ogStatusId({ kind: 'p', code: 'DAbc' })]: og.noPic }).get))!;
    expect(p.text).toBeUndefined(); expect(p.author.name).toBe('someone'); expect(statsLine(p.stats)).toBe('💬 0');
  });

  test('Instaloader is never started when OGInstagram answers', async () => {
    const ran: string[] = [];
    const script: ScriptRunner = async code => { ran.push(code); return ''; };
    const p = await instagramRepost('https://www.instagram.com/reel/CxAbCdEfGhI/?igsh=abc', { maxBytes: 9e6, scriptRun: script, statusGet: fixer({ [OG + og.reelId]: og.reel }).get });
    expect(ran).toEqual([]); expect(p.author.handle).toBe('britneyspears');
  });

  test('when OGInstagram errs or has no post, Instaloader takes over', async () => {
    for (const statusGet of [fixer({}).get, async () => ({ error: 'Record not found' }) as MastoStatus]) {
      const ran: string[] = [];
      const script: ScriptRunner = async code => { ran.push(code); return JSON.stringify({ ok: true, shortcode: code, username: 'nasa', media: [{ type: 'image', url: 'https://scontent.cdninstagram.com/a.jpg' }] }); };
      const p = await instagramRepost('https://www.instagram.com/p/DW1nTDiDvnF/', { maxBytes: 9e6, scriptRun: script, statusGet });
      expect(ran).toEqual(['DW1nTDiDvnF']); expect(p.media[0]!.url).toBe('https://scontent.cdninstagram.com/a.jpg');
    }
  });
});

describe('/tiktok repost asks tnktok first', () => {
  const VIDEO = '7412345678901234567', PHOTOS = '7412345678901234568', SMALL = '7412345678901234569';

  test('the post id is read from any full link; a short link has none', () => {
    expect(tiktokIdOf(`https://www.tiktok.com/@bob.smith/video/${VIDEO}?is_from_webapp=1`)).toBe(VIDEO);
    expect(tiktokIdOf(`https://www.tiktok.com/@bob/photo/${PHOTOS}`)).toBe(PHOTOS);
    expect(tiktokIdOf(`https://m.tiktok.com/v/${VIDEO}.html`)).toBe(VIDEO);
    expect(tiktokIdOf('https://vm.tiktok.com/ZMabc123/')).toBeNull();
    expect(tiktokIdOf('https://www.tiktok.com/@bob')).toBeNull();
  });

  test('a video is one request: the author (verified), the caption, when it was posted, likes, comments and shares, and the video', async () => {
    const f = fixer({ [`${TNK}${VIDEO}desc`]: tnk.video });
    const p = (await tnktokPost(VIDEO, f.get))!;
    expect(f.seen).toEqual([`${TNK}${VIDEO}desc`]);
    expect(p.author).toEqual({ name: 'Bob <Smith>', handle: 'bob.smith', avatar: tnk.video.account.avatar, url: 'https://www.tiktok.com/@bob.smith', verified: true });
    expect(p.text).toBe('hello @alice #fyp & more');
    expect(p.createdAt).toBe(Date.parse('2024-09-10T20:26:40Z'));
    expect(statsLine(p.stats)).toBe('♡ 1.2m · 💬 8.9k · ↗️ 345');
    expect(p.media).toEqual([{ type: 'video', url: `https://offload.tnktok.com/generate/video/${VIDEO}`, thumb: tnk.video.media_attachments[0]!.preview_url! }]);
    expect(p.url).toBe(`https://www.tiktok.com/@bob.smith/video/${VIDEO}`);
  });

  test('a photo post over four photos has its other pages fetched, so every photo is on the card', async () => {
    const f = fixer({ [`${TNK}${PHOTOS}desc`]: tnk.photos1, [`${TNK}${PHOTOS}descpage2`]: tnk.photos2 });
    const p = (await tnktokPost(PHOTOS, f.get))!;
    expect(f.seen).toEqual([`${TNK}${PHOTOS}desc`, `${TNK}${PHOTOS}descpage2`]);
    expect(p.media.map(m => m.url.split('/').at(-1))).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(p.text).toBe('My <trip>\nseven pics'); // tnktok doesn't escape captions, so only its own tags are taken out
    expect((await tnktokPost(PHOTOS, fixer({ [`${TNK}${PHOTOS}desc`]: tnk.photos1 }).get))!.media).toHaveLength(4); // page 2 failed: page 1 alone
  });

  test('no caption, no badge, and small counts shown as they are', async () => {
    const p = (await tnktokPost(SMALL, fixer({ [`${TNK}${SMALL}desc`]: tnk.small }).get))!;
    expect(p.text).toBeUndefined(); expect(p.author.verified).toBeUndefined(); expect(p.author.name).toBe('Plain');
    expect(statsLine(p.stats)).toBe('♡ 0 · 💬 999 · ↗️ 1k');
  });

  test('a short link is looked up for its id, and the card can go out at once', async () => {
    const f = fixer({ [`${TNK}${VIDEO}desc`]: tnk.video });
    const looked: string[] = [];
    const r = await tiktokRepost('https://vm.tiktok.com/ZMabc123/', { statusGet: f.get, resolve: async u => { looked.push(u); return `https://www.tiktok.com/@bob.smith/video/${VIDEO}?_r=1`; }, tikwm: async () => { throw new Error('not asked'); } });
    expect(looked).toEqual(['https://vm.tiktok.com/ZMabc123/']); expect(r.quick).toBe(true); expect(r.post.author.handle).toBe('bob.smith');
  });

  test('when tnktok can\'t answer, TikWM does, as before (its media are downloaded before sending)', async () => {
    const fromTikwm = { site: 'TikTok', url: 'x', author: { name: 'Bob' }, stats: [], media: [], color: 0 } as RepostPost;
    const asked: string[] = [];
    const tikwm = async (u: string) => { asked.push(u); return fromTikwm; };
    for (const o of [{ statusGet: fixer({}).get }, { statusGet: fixer({}).get, resolve: async () => null }]) {
      const r = await tiktokRepost(`https://www.tiktok.com/@bob/video/${VIDEO}`, { ...o, tikwm });
      expect(r).toEqual({ post: fromTikwm, quick: false });
    }
    await tiktokRepost('https://vm.tiktok.com/ZMabc/', { resolve: async () => null, statusGet: fixer({}).get, tikwm }); // no id found: straight to TikWM
    expect(asked).toEqual([`https://www.tiktok.com/@bob/video/${VIDEO}`, `https://www.tiktok.com/@bob/video/${VIDEO}`, 'https://vm.tiktok.com/ZMabc/']);
  });

  test('a link that isn\'t TikTok\'s is refused before anything is asked', async () => {
    const f = fixer({});
    await expect(tiktokRepost('https://evil.example/@bob/video/1234567890123', { statusGet: f.get, tikwm: async () => { throw new Error('not asked'); } })).rejects.toBeInstanceOf(LookupError);
    expect(f.seen).toEqual([]);
  });
});
