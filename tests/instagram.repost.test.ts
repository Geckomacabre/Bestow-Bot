import { describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DownloadError, SIZE_OR_LENGTH, explainFailure, type Runner } from '../src/media/download';
import { MediaError } from '../src/framework/media';
import { LookupError } from '../src/lookups/handler';
import { InstaloaderMissing, fetchInstagramPost, instaPost, instagramRepost, instagramShortcode, type InstaJson, type ScriptRunner } from '../src/lookups/instaloader';

const REEL = 'https://www.instagram.com/reel/CxAbCdEfGhI/';
const PHOTOS = 'https://www.instagram.com/p/DW1nTDiDvnF/';

/** A fake yt-dlp: `script` decides what each call does (write files into cwd, print JSON, fail). */
function fakeYtdlp(script: (n: number, cwd: string) => Promise<{ code: number; stdout?: string; stderr?: string }>): { run: Runner; calls: number } {
  const state = { calls: 0 };
  return { get calls() { return state.calls; }, run: async (_c, _a, { cwd }) => { const r = await script(++state.calls, cwd); return { code: r.code, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }; } } as { run: Runner; calls: number };
}
const okVideo = fakeYtdlp;
const goodVideo = () => okVideo(async (_n, cwd) => {
  await writeFile(path.join(cwd, 'out.mp4'), Buffer.from('video'));
  return { code: 0, stdout: JSON.stringify({ id: 'x', channel: 'britneyspears', uploader: 'Britney Spears', uploader_id: '12246775', description: 'hi', like_count: 88231, comment_count: 6854, timestamp: 1453760977, webpage_url: REEL }) };
});
const noVideo = () => fakeYtdlp(async () => ({ code: 1, stderr: 'ERROR: [Instagram] DW1nFOODjs4: No video formats found!; please report this issue on  https://github.com/yt-dlp/yt-dlp/issues?q=' }));

const carousel: InstaJson = {
  ok: true, shortcode: 'DW1nTDiDvnF', username: 'nasa', full_name: 'NASA', avatar: null, verified: false, caption: 'Hello, Moon.', timestamp: 1775580510, likes: 11101714, comments: 46439, views: null,
  media: [{ type: 'image', url: 'https://scontent.cdninstagram.com/a.jpg' }, { type: 'image', url: 'https://scontent.cdninstagram.com/b.jpg' }, { type: 'video', url: 'https://scontent.cdninstagram.com/c.mp4' }],
};
const script = (j: InstaJson | string, seen: string[] = []): ScriptRunner => async code => { seen.push(code); return typeof j === 'string' ? j : `${JSON.stringify(j)}\n`; };

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

describe('a photo post no longer ends in "I couldn\'t download that"', () => {
  test('yt-dlp\'s "No video formats found" is explained on its own, not as a generic failure', () => {
    expect(explainFailure('ERROR: [Instagram] X: No video formats found!; please report this issue')).toContain('no video in it');
    expect(explainFailure('something new')).toContain('couldn\'t download that');
  });

  test('a photo carousel falls back to Instaloader and comes back with every slide', async () => {
    const seen: string[] = [], y = noVideo();
    const post = await instagramRepost(PHOTOS, { maxBytes: 9_000_000, ytdlpRun: y.run, scriptRun: script(carousel, seen) });
    expect(seen).toEqual(['DW1nTDiDvnF']);
    expect(post.media.map(m => m.type)).toEqual(['image', 'image', 'video']);
    expect(post.media[0]!.url).toBe('https://scontent.cdninstagram.com/a.jpg');
    expect(post.author).toMatchObject({ name: 'NASA', handle: 'nasa', url: 'https://www.instagram.com/nasa/' });
    expect(post.text).toBe('Hello, Moon.'); expect(post.createdAt).toBe(1775580510 * 1000); expect(post.url).toBe('https://www.instagram.com/p/DW1nTDiDvnF/');
    expect(post.stats.map(s => s.value)).toEqual([11101714, 46439, null]);
  });

  test('a video is left to yt-dlp: Instaloader is never asked, and the card names the account rather than its numeric id', async () => {
    const seen: string[] = [], y = goodVideo();
    const post = await instagramRepost(REEL, { maxBytes: 9_000_000, ytdlpRun: y.run, scriptRun: script(carousel, seen) });
    expect(seen).toEqual([]); expect(y.calls).toBe(1);
    expect(post.author.handle).toBe('britneyspears'); expect(post.author.url).toBe('https://www.instagram.com/britneyspears/'); expect(post.author.name).toBe('Britney Spears');
    expect(post.media[0]).toMatchObject({ type: 'video', ext: 'mp4' });
  });

  test('yt-dlp turned away by a login wall gets a second try', async () => {
    const seen: string[] = [];
    const y = fakeYtdlp(async () => ({ code: 1, stderr: 'ERROR: [Instagram] CDoW25zgHMg: Instagram sent an empty media response. Check if this post is accessible in your browser without being logged-in.' }));
    await instagramRepost(REEL, { maxBytes: 9_000_000, ytdlpRun: y.run, scriptRun: script(carousel, seen) });
    expect(seen).toEqual(['CxAbCdEfGhI']);
  });

  test('a video that is too long or too big is not retried — Instaloader could not shrink it', async () => {
    for (const stderr of ['ERROR: File is larger than max-filesize (12000000 bytes > 9000000 bytes)', 'reel does not pass filter (!is_live & duration<=600), skipping ..']) {
      const seen: string[] = [];
      const y = fakeYtdlp(async () => ({ code: 1, stderr }));
      const err = await instagramRepost(REEL, { maxBytes: 9_000_000, ytdlpRun: y.run, scriptRun: script(carousel, seen) }).catch(e => e);
      expect(err).toBeInstanceOf(DownloadError); expect(seen, stderr).toEqual([]);
    }
    expect(SIZE_OR_LENGTH.test('No video formats found!')).toBe(false);
  });

  test('when Instagram wants a login for both, the reason is stated plainly', async () => {
    const err = await instagramRepost(PHOTOS, { maxBytes: 9_000_000, ytdlpRun: noVideo().run, scriptRun: script({ ok: false, kind: 'login' }) }).catch(e => e);
    expect(err).toBeInstanceOf(LookupError); expect(err.message).toContain('without a login');
  });

  test('if Instaloader is not installed, the user gets what yt-dlp said instead', async () => {
    const err = await instagramRepost(PHOTOS, { maxBytes: 9_000_000, ytdlpRun: noVideo().run, scriptRun: async () => { throw new InstaloaderMissing('nope'); } }).catch(e => e);
    expect(err).toBeInstanceOf(DownloadError); expect(err.message).toContain('no video in it');
  });

  test('an error that is not a failed download (yt-dlp itself missing) is not turned into a second attempt', async () => {
    const seen: string[] = [];
    const y = fakeYtdlp(async () => { throw new MediaError('The downloader (yt-dlp) isn\'t installed on this bot.'); });
    const err = await instagramRepost(REEL, { maxBytes: 9_000_000, ytdlpRun: y.run, scriptRun: script(carousel, seen) }).catch(e => e);
    expect(err.message).toContain('isn\'t installed'); expect(seen).toEqual([]);
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
