import path from 'node:path';
import { getBufferPublic } from '../framework/http.js';
import { DownloadError, SIZE_OR_LENGTH, downloadPost, type Runner } from '../media/download.js';
import { LookupError } from './handler.js';
import { ytdlpPost, type RepostPost } from './repost.js';

/**
 * /instagram repost. Instaloader (https://github.com/instaloader/instaloader) reads the post itself — every photo or video in it, the
 * caption, the counts — in about a second, and the media files then download straight from Instagram's CDN. That is the fast path
 * and it handles photos, carousels, reels and videos alike. yt-dlp is the second opinion: it takes over when Instaloader can't read the
 * post, and when a single video is too big to upload as it is (it can pick a smaller version, which Instaloader can't).
 * The helper is src/lookups/instaloader_post.py (Python and `pip install instaloader` are in the Docker image). Env: INSTALOADER_PYTHON
 * (default python3); INSTALOADER_USER + INSTALOADER_SESSIONFILE (optional: a session from `instaloader --login`, for posts Instagram
 * only shows to signed-in visitors).
 */

export const INSTAGRAM_COLOR = 0xe1306c;
const SCRIPT = path.resolve(import.meta.dir, 'instaloader_post.py');
const TIMEOUT_MS = 60_000;

/** The shortcode of a post, reel or IGTV link — null for anything else (a profile, another site, a look-alike host). */
export function instagramShortcode(link: string): string | null {
  return /^https:\/\/(?:www\.)?instagram\.com\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/([\w-]+)/i.exec(link.trim())?.[1] ?? null;
}

/** What instaloader_post.py prints. */
export type InstaJson =
  | { ok: false; kind: 'login' | 'notfound' | 'ratelimit' | 'error'; message?: string }
  | {
    ok: true; shortcode: string; username: string; full_name?: string | null; avatar?: string | null; verified?: boolean; caption?: string; timestamp?: number;
    likes?: number | null; comments?: number | null; views?: number | null; media: { type: 'image' | 'video'; url: string }[];
  };

/** Runs the helper for one shortcode and returns what it printed. Tests replace it. */
export type ScriptRunner = (shortcode: string) => Promise<string>;

/** Thrown when the helper cannot run at all (Python or Instaloader missing) — so the caller can keep the earlier, more useful error. */
export class InstaloaderMissing extends Error {}

const defaultRun: ScriptRunner = async shortcode => {
  let proc: ReturnType<typeof Bun.spawn>;
  try { proc = Bun.spawn([Bun.env.INSTALOADER_PYTHON ?? 'python3', SCRIPT, shortcode], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env } }); }
  catch { throw new InstaloaderMissing('python is not installed'); }
  const timer = setTimeout(() => proc.kill(), TIMEOUT_MS);
  try {
    const [out, err] = await Promise.all([new Response(proc.stdout as ReadableStream).text(), new Response(proc.stderr as ReadableStream).text()]);
    await proc.exited;
    if (!out.trim() && /No module named 'instaloader'|ModuleNotFoundError/.test(err)) throw new InstaloaderMissing('instaloader is not installed');
    return out;
  } finally { clearTimeout(timer); }
};

const WHY: Record<string, string> = {
  login: 'Instagram won\'t show me that post without a login — it may be private, deleted, or blocked for bots.',
  notfound: 'I couldn\'t find that Instagram post. It may have been deleted.',
  ratelimit: 'Instagram is rate-limiting me right now — try again in a few minutes.',
  error: 'I couldn\'t read that Instagram post.',
};

/** The helper's answer as a repost, or the reason it couldn't be read. */
export function instaPost(j: InstaJson, link: string): RepostPost {
  if (!j.ok) throw new LookupError(WHY[j.kind] ?? WHY.error!);
  if (!j.media.length) throw new LookupError(WHY.error!);
  const url = `https://www.instagram.com/p/${j.shortcode}/`;
  return {
    site: 'Instagram', color: INSTAGRAM_COLOR, url,
    author: { name: j.full_name || j.username, handle: j.username, url: `https://www.instagram.com/${j.username}/`, avatar: j.avatar ?? undefined, verified: j.verified || undefined },
    text: j.caption || undefined, createdAt: j.timestamp ? j.timestamp * 1000 : undefined,
    stats: [{ icon: '♡', value: j.likes }, { icon: '💬', value: j.comments }, { icon: '', value: j.views, suffix: ' views' }],
    media: j.media.map(m => ({ type: m.type, url: m.url })),
  };
}

/** Reads a post with Instaloader — photos, carousels and videos alike. */
export async function fetchInstagramPost(link: string, run: ScriptRunner = defaultRun): Promise<RepostPost> {
  const code = instagramShortcode(link);
  if (!code) throw new LookupError('Send an Instagram post or reel link like `https://www.instagram.com/reel/…`.');
  const out = await run(code);
  let j: InstaJson;
  try { j = JSON.parse(out.trim().split('\n').at(-1) ?? ''); } catch { throw new LookupError(WHY.error!); }
  return instaPost(j, link);
}

const downloadFile = (url: string, maxBytes: number) => getBufferPublic(url, { maxBytes, timeoutMs: 45_000 });

/** yt-dlp's take on a post: the video, sized to fit. `first` is what Instaloader said if it had already failed. */
async function viaYtdlp(link: string, o: { maxBytes: number; ytdlpRun?: Runner }, first?: unknown): Promise<RepostPost> {
  try {
    const r = await downloadPost(link, { maxBytes: o.maxBytes, run: o.ytdlpRun });
    const post = ytdlpPost('Instagram', INSTAGRAM_COLOR, r.info, r, link);
    // yt-dlp's uploader_id is Instagram's numeric id; the username is its `channel`.
    if (r.info.channel) { post.author.handle = r.info.channel; post.author.url = `https://www.instagram.com/${r.info.channel}/`; }
    return post;
  } catch (err) {
    // Instaloader's reason is the more useful one — unless yt-dlp could read the post and it is just too long or too big.
    if (first !== undefined && !(err instanceof DownloadError && SIZE_OR_LENGTH.test(err.detail))) throw first;
    throw err;
  }
}

/**
 * The repost for an Instagram link. Instaloader reads the post (about a second) and its files are downloaded straight from the CDN;
 * yt-dlp is only asked when Instaloader can't read the post, or when a single video is too big to upload as it is — yt-dlp can pick a
 * smaller version of it, and if it can't either, the video stays on the card as a link.
 */
export async function instagramRepost(
  link: string,
  o: { maxBytes: number; ytdlpRun?: Runner; scriptRun?: ScriptRunner; download?: (url: string, maxBytes: number) => Promise<Buffer> },
): Promise<RepostPost> {
  let post: RepostPost;
  try {
    post = await fetchInstagramPost(link, o.scriptRun);
  } catch (err) {
    // Not installed: yt-dlp is all there is, and its errors are the ones to show. Otherwise Instaloader's answer is kept for the message.
    return viaYtdlp(link, o, err instanceof InstaloaderMissing ? undefined : err);
  }
  const only = post.media.length === 1 && post.media[0]!.type === 'video' ? post.media[0]! : null;
  if (only) {
    // Fetched here, not left to the card, so one that doesn't fit can be swapped for a smaller version.
    try { only.data = await (o.download ?? downloadFile)(only.url, o.maxBytes); only.ext = 'mp4'; }
    catch { return viaYtdlp(link, o).catch(() => post); }
  }
  return post;
}
