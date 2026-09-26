import { describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DownloadError, SIZE_OR_LENGTH, explainFailure, type Runner } from '../src/media/download';
import { MediaError } from '../src/framework/media';
import { LookupError } from '../src/lookups/handler';
import { fetchMedia } from '../src/lookups/repost';
import { InstaloaderMissing, fetchInstagramPost, instaPost, instagramRepost, instagramShortcode, type InstaJson, type ScriptRunner } from '../src/lookups/instaloader';

const REEL = 'https://www.instagram.com/reel/CxAbCdEfGhI/';
const PHOTOS = 'https://www.instagram.com/p/DW1nTDiDvnF/';

/** A fake yt-dlp: `script` decides what each call does (write files into cwd, print JSON, fail). */
function fakeYtdlp(script: (n: number, cwd: string) => Promise<{ code: number; stdout?: string; stderr?: string }>): { run: Runner; calls: number } {
  const state = { calls: 0 };
  return { get calls() { return state.calls; }, run: async (_c, _a, { cwd }) => { const r = await script(++state.calls, cwd); return { code: r.code, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }; } } as { run: Runner; calls: number };
}
/** yt-dlp fetching a small video, the way it reports one for Instagram. */
const goodVideo = () => fakeYtdlp(async (_n, cwd) => {
  await writeFile(path.join(cwd, 'out.mp4'), Buffer.from('small-video'));
  return { code: 0, stdout: JSON.stringify({ id: 'x', channel: 'britneyspears', uploader: 'Britney Spears', uploader_id: '12246775', description: 'hi', like_count: 88231, comment_count: 6854, timestamp: 1453760977, webpage_url: REEL }) };
});
const noVideo = () => fakeYtdlp(async () => ({ code: 1, stderr: 'ERROR: [Instagram] DW1nFOODjs4: No video formats found!; please report this issue on  https://github.com/yt-dlp/yt-dlp/issues?q=' }));
const failing = (stderr: string) => fakeYtdlp(async () => ({ code: 1, stderr }));

const carousel: InstaJson = {
  ok: true, shortcode: 'DW1nTDiDvnF', username: 'nasa', full_name: 'NASA', avatar: null, verified: false, caption: 'Hello, Moon.', timestamp: 1775580510, likes: 11101714, comments: 46439, views: null,
  media: [{ type: 'image', url: 'https://scontent.cdninstagram.com/a.jpg' }, { type: 'image', url: 'https://scontent.cdninstagram.com/b.jpg' }, { type: 'video', url: 'https://scontent.cdninstagram.com/c.mp4' }],
};
const reel: InstaJson = { ...carousel, shortcode: 'CxAbCdEfGhI', username: 'britneyspears', full_name: 'Britney Spears', media: [{ type: 'video', url: 'https://scontent.cdninstagram.com/reel.mp4' }] } as InstaJson;
const script = (j: InstaJson | string, seen: string[] = []): ScriptRunner => async code => { seen.push(code); return typeof j === 'string' ? j : `${JSON.stringify(j)}\n`; };
const missing: ScriptRunner = async () => { throw new InstaloaderMissing('nope'); };
/** A stand-in for downloading a file from the CDN: records what was asked for, and can refuse (too big). */
const cdn = (o: { tooBig?: boolean } = {}) => {
  const asked: { url: string; max: number }[] = [];
  return { asked, download: async (url: string, max: number) => { asked.push({ url, max }); if (o.tooBig) throw new Error('over the limit'); return Buffer.from('reel-bytes'); } };
};

describe('Instagram links', () => {
  test('posts, reels and IGTV are recognised, with or without a username in the path', () => {
    expect(instagramShortcode(REEL)).toBe('CxAbCdEfGhI');
    expect(instagramShortcode('https://instagram.com/p/DW1nTDiDvnF/?utm_source=ig_web')).toBe('DW1nTDiDvnF');
    expect(instagramShortcode('https://www.instagram.com/reels/Abc_-123xyz/')).toBe('Abc_-123xyz');
    expect(instagramShortcode('https://www.instagram.com/tv/Abc123/')).toBe('Abc123');
    expect(instagramShortcode('https://www.instagram.com/nasa/p/DW1nTDiDvnF/')).toBe('DW1nTDiDvnF');
  });
  test('profiles, other sites and look-alikes are not', () => {
    for (const u of ['https://www.instagram.com/nasa/', 'https://example.com/p/abc123/', 'https://instagram.com.evil.com/p/abc123/', 'http://www.instagram.com/p/abc123/', 'https://www.instagram.com/stories/nasa/1/', 'not a link', ''])
      expect(instagramShortcode(u), u).toBeNull();
  });
});

describe('Instaloader reads the post first, so a repost is quick', () => {
  test('a carousel is read once; yt-dlp is never started and no media is fetched here (the card fetches the photos in parallel)', async () => {
    const seen: string[] = [], y = noVideo(), c = cdn();
    const post = await instagramRepost(PHOTOS, { maxBytes: 9_000_000, ytdlpRun: y.run, scriptRun: script(carousel, seen), download: c.download });
    expect(seen).toEqual(['DW1nTDiDvnF']); expect(y.calls).toBe(0); expect(c.asked).toEqual([]);
    expect(post.media.map(m => m.type)).toEqual(['image', 'image', 'video']);
    expect(post.media[0]!.url).toBe('https://scontent.cdninstagram.com/a.jpg');
    expect(post.author).toMatchObject({ name: 'NASA', handle: 'nasa', url: 'https://www.instagram.com/nasa/' });
    expect(post.text).toBe('Hello, Moon.'); expect(post.createdAt).toBe(1775580510 * 1000); expect(post.url).toBe('https://www.instagram.com/p/DW1nTDiDvnF/');
    expect(post.stats.map(s => s.value)).toEqual([11101714, 46439, null]);
  });

  test('a single video is downloaded straight from its link, within the upload limit — no yt-dlp, no re-encoding', async () => {
    const seen: string[] = [], y = goodVideo(), c = cdn();
    const post = await instagramRepost(REEL, { maxBytes: 9_000_000, ytdlpRun: y.run, scriptRun: script(reel, seen), download: c.download });
    expect(y.calls).toBe(0); expect(c.asked).toEqual([{ url: 'https://scontent.cdninstagram.com/reel.mp4', max: 9_000_000 }]);
    expect(post.media[0]).toMatchObject({ type: 'video', ext: 'mp4' }); expect(post.media[0]!.data?.toString()).toBe('reel-bytes');
    expect(post.author.handle).toBe('britneyspears');
  });

  test('a video that does not fit is swapped for the smaller one yt-dlp can make', async () => {
    const y = goodVideo(), c = cdn({ tooBig: true });
    const post = await instagramRepost(REEL, { maxBytes: 9_000_000, ytdlpRun: y.run, scriptRun: script(reel), download: c.download });
    expect(y.calls).toBe(1); expect(post.media[0]!.data?.toString()).toBe('small-video');
    expect(post.author.handle).toBe('britneyspears'); expect(post.author.url).toBe('https://www.instagram.com/britneyspears/'); // the name, not the numeric id yt-dlp reports
  });

  test('and if yt-dlp cannot either, the card still comes out — the video stays a link', async () => {
    const post = await instagramRepost(REEL, { maxBytes: 9_000_000, ytdlpRun: failing('HTTP Error 429').run, scriptRun: script(reel), download: cdn({ tooBig: true }).download });
    expect(post.media).toHaveLength(1); expect(post.media[0]!.data).toBeUndefined(); expect(post.author.handle).toBe('britneyspears');
  });
});

describe('when Instaloader cannot read the post, yt-dlp gets its turn', () => {
  test('a login wall on Instaloader\'s side is tried with yt-dlp, which may be signed in through its own cookies', async () => {
    const y = goodVideo();
    const post = await instagramRepost(REEL, { maxBytes: 9_000_000, ytdlpRun: y.run, scriptRun: script({ ok: false, kind: 'login' }) });
    expect(y.calls).toBe(1); expect(post.media[0]!.data?.toString()).toBe('small-video');
  });

  test('when both are turned away, Instagram\'s reason is stated plainly', async () => {
    const err = await instagramRepost(PHOTOS, { maxBytes: 9_000_000, ytdlpRun: noVideo().run, scriptRun: script({ ok: false, kind: 'login' }) }).catch(e => e);
    expect(err).toBeInstanceOf(LookupError); expect(err.message).toContain('without a login');
  });

  test('but if yt-dlp could read it and it is simply too long or too big, that is what the user is told', async () => {
    for (const stderr of ['ERROR: File is larger than max-filesize (12000000 bytes > 9000000 bytes)', 'reel does not pass filter (!is_live & duration<=600), skipping ..']) {
      const err = await instagramRepost(REEL, { maxBytes: 9_000_000, ytdlpRun: failing(stderr).run, scriptRun: script({ ok: false, kind: 'login' }) }).catch(e => e);
      expect(err, stderr).toBeInstanceOf(DownloadError);
    }
    expect(SIZE_OR_LENGTH.test('No video formats found!')).toBe(false);
  });

  test('if yt-dlp itself is missing, Instaloader\'s answer is the one shown', async () => {
    const y = fakeYtdlp(async () => { throw new MediaError('The downloader (yt-dlp) isn\'t installed on this bot.'); });
    const err = await instagramRepost(REEL, { maxBytes: 9_000_000, ytdlpRun: y.run, scriptRun: script({ ok: false, kind: 'ratelimit' }) }).catch(e => e);
    expect(err.message).toContain('rate-limiting');
  });

  test('if Instaloader is not installed at all, yt-dlp does everything and its own words are shown', async () => {
    expect(await instagramRepost(REEL, { maxBytes: 9_000_000, ytdlpRun: goodVideo().run, scriptRun: missing }).then(p => p.media[0]!.data?.toString())).toBe('small-video');
    const err = await instagramRepost(PHOTOS, { maxBytes: 9_000_000, ytdlpRun: noVideo().run, scriptRun: missing }).catch(e => e);
    expect(err).toBeInstanceOf(DownloadError); expect(err.message).toContain('no video in it');
  });

  test('yt-dlp\'s "No video formats found" is explained on its own, not as a generic failure', () => {
    expect(explainFailure('ERROR: [Instagram] X: No video formats found!; please report this issue')).toContain('no video in it');
    expect(explainFailure('something new')).toContain('couldn\'t download that');
  });
});

describe('reading the helper\'s answer', () => {
  test('every reason it can give is a plain sentence', () => {
    const msg = (kind: 'login' | 'notfound' | 'ratelimit' | 'error') => { try { instaPost({ ok: false, kind }, PHOTOS); } catch (e) { return (e as Error).message; } return ''; };
    expect(msg('login')).toContain('without a login'); expect(msg('notfound')).toContain('deleted'); expect(msg('ratelimit')).toContain('rate-limiting'); expect(msg('error')).toContain('couldn\'t read');
  });

  test('hidden like counts and missing fields are left off the card, and the display name falls back to the username', () => {
    const p = instaPost({ ...carousel, full_name: null, likes: null, comments: 0, caption: '', timestamp: undefined } as InstaJson, PHOTOS);
    expect(p.author.name).toBe('nasa'); expect(p.text).toBeUndefined(); expect(p.createdAt).toBeUndefined();
    expect(p.stats.map(s => s.value)).toEqual([null, 0, null]);
  });

  test('a post with nothing in it, garbage output and an empty answer are all reported, never thrown raw', async () => {
    await expect(fetchInstagramPost(PHOTOS, script({ ...carousel, media: [] } as InstaJson))).rejects.toBeInstanceOf(LookupError);
    await expect(fetchInstagramPost(PHOTOS, script('Traceback (most recent call last): boom'))).rejects.toBeInstanceOf(LookupError);
    await expect(fetchInstagramPost(PHOTOS, script(''))).rejects.toBeInstanceOf(LookupError);
  });

  test('only the last line counts, so a warning printed first cannot break it', async () => {
    const p = await fetchInstagramPost(PHOTOS, script(`some warning\n${JSON.stringify(carousel)}\n`));
    expect(p.media).toHaveLength(3);
  });

  test('a link that is not a post is refused before anything runs', async () => {
    const seen: string[] = [];
    await expect(fetchInstagramPost('https://www.instagram.com/nasa/', script(carousel, seen))).rejects.toBeInstanceOf(LookupError);
    expect(seen).toEqual([]);
  });
});

describe('a card\'s media come down together, but are still taken in order and within the limit', () => {
  const item = (label: string, bytes: number) => ({ type: 'image' as const, url: `https://x.example/${label}.jpg`, data: Buffer.alloc(bytes), ext: 'jpg' });

  test('the total stays under the limit: what fits is attached in order, the rest is left as links', async () => {
    const got = await fetchMedia([item('a', 5), item('b', 5), item('c', 5), item('d', 2)], 12);
    expect(got.items).toEqual(['attachment://photo1.jpg', 'attachment://photo2.jpg', 'attachment://photo4.jpg']);
    expect(got.skipped.map(m => m.url)).toEqual(['https://x.example/c.jpg']);
  });

  test('at most ten are attached, however many there are, and files keep the numbering of their place in the post', async () => {
    const got = await fetchMedia(Array.from({ length: 14 }, (_, n) => item(`p${n}`, 1)), 100);
    expect(got.files).toHaveLength(10); expect(got.items.at(-1)).toBe('attachment://photo10.jpg');
  });

  test('one that cannot be fetched is skipped and does not spoil the others', async () => {
    const bad = { type: 'image' as const, url: 'https://127.0.0.1/private.jpg' }; // refused by the public-address guard
    const got = await fetchMedia([item('a', 1), bad, item('c', 1)], 100);
    expect(got.items).toEqual(['attachment://photo1.jpg', 'attachment://photo3.jpg']); expect(got.skipped).toEqual([bad]);
  });
});
