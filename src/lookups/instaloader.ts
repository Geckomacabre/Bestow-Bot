import path from 'node:path';
import { DownloadError, SIZE_OR_LENGTH, downloadPost, type Runner } from '../media/download.js';
import { countAfter, getStatus, htmlText, statusMedia, statusTime, type MastoStatus, type StatusGet } from './fixembed.js';
import { LookupError } from './handler.js';
import { ytdlpPost, type RepostPost } from './repost.js';

/**
 * /instagram repost. OGInstagram (https://github.com/seirenkr/OGInstagram) is asked first: one JSON request, the way /x repost asks
 * FxTwitter, gives the caption, the author, when it was posted, the counts and links to every photo or video. Its links last two weeks
 * and Discord can show them directly. When it can't answer, Instaloader (https://github.com/instaloader/instaloader) reads the post
 * itself, and yt-dlp is the last resort after that. Instaloader's helper is src/lookups/instaloader_post.py (Python and `pip install
 * instaloader` are in the Docker image). Env: OGINSTAGRAM_URL (default https://oginstagram.com); INSTALOADER_PYTHON (default python3);
 * INSTALOADER_USER + INSTALOADER_SESSIONFILE (optional: a session from `instaloader --login`, for posts Instagram only shows to
 * signed-in visitors).
 */

export const INSTAGRAM_COLOR = 0xe1306c;
const OGINSTAGRAM = (Bun.env.OGINSTAGRAM_URL || 'https://oginstagram.com').replace(/\/+$/, '');
const SCRIPT = path.resolve(import.meta.dir, 'instaloader_post.py');
const TIMEOUT_MS = 60_000;

/** What kind of post a link points at, and its shortcode — null for anything else (a profile, another site, a look-alike host). */
export function instagramRef(link: string): { kind: 'p' | 'reel' | 'tv'; code: string } | null {
  const m = /^https:\/\/(?:www\.)?instagram\.com\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([\w-]+)/i.exec(link.trim());
  if (!m) return null;
  const kind = m[1]!.toLowerCase();
  return { kind: kind === 'reels' ? 'reel' : (kind as 'p' | 'reel' | 'tv'), code: m[2]! };
}

/** The shortcode of a post, reel or IGTV link. */
export const instagramShortcode = (link: string) => instagramRef(link)?.code ?? null;

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

/**
 * OGInstagram's id for a post, or for item `n` (from 1) of a carousel: its key/values (`"i":"<shortcode>"`, then `"p":"reel"` for a
 * reel and `"n":<n>` for one item) read as a single number. These are the ids it hands Discord, so a post that has already been
 * embedded somewhere is answered from its cache.
 */
export function ogStatusId(ref: { kind: string; code: string }, n?: number): string {
  let payload = `"i":"${ref.code}"`;
  if (ref.kind === 'reel') payload += ',"p":"reel"';
  if (n) payload += `,"n":${n}`;
  return BigInt(`0x${Buffer.from(payload).toString('hex')}`).toString();
}

/** OGInstagram puts the counts in a bold first paragraph ("🖼️ 7  ▶️ 1,234  ❤️ 56  💬 7") and the caption after it. */
const STATS_PARAGRAPH = /^\s*<p><b>([\s\S]*?)<\/b><\/p>/;
const statsOf = (s: MastoStatus) => htmlText(STATS_PARAGRAPH.exec(s.content ?? '')?.[1] ?? '');

/** How many items the post has: the 🖼️ count ("🖼️ 7", or "🖼️ 1 / 7" when only one is shown); 1 when there is none. */
const itemCount = (stats: string) => Number(/\u{1F5BC}\uFE0F?\s*(?:\d+\s*\/\s*)?(\d+)/u.exec(stats)?.[1] ?? 1);

/** OGInstagram's answer as a repost, or null if it holds no post. */
export function ogPost(s: MastoStatus, code: string): RepostPost | null {
  const handle = s.account?.username;
  const media = statusMedia(s);
  if (!handle || !media.length) return null;
  const stats = statsOf(s);
  return {
    site: 'Instagram', color: INSTAGRAM_COLOR, url: `https://www.instagram.com/p/${code}/`,
    author: { name: s.account?.display_name || handle, handle, url: `https://www.instagram.com/${handle}/`, avatar: s.account?.avatar || undefined },
    text: htmlText((s.content ?? '').replace(STATS_PARAGRAPH, '')) || undefined, createdAt: statusTime(s),
    // A hidden like count comes through as 0, so 0 is left off like any other count that isn't known.
    stats: [{ icon: '♡', value: countAfter(stats, '❤️') || undefined }, { icon: '💬', value: countAfter(stats, '💬') }, { icon: '', value: countAfter(stats, '▶️'), suffix: ' views' }],
    media,
  };
}

/**
 * A post from OGInstagram. Its answer for a whole carousel holds up to four photos, or only the first item if that is a video, so a
 * carousel it doesn't answer in full is asked for item by item (up to ten, all at once); should any of those fail, the first answer
 * is used as it was. Null if OGInstagram holds no post.
 */
export async function ogInstagramPost(ref: { kind: string; code: string }, get: StatusGet = getStatus): Promise<RepostPost | null> {
  const first = await get(`${OGINSTAGRAM}/api/v1/statuses/${ogStatusId(ref)}`);
  const post = ogPost(first, ref.code);
  if (!post) return null;
  const total = Math.min(10, itemCount(statsOf(first)));
  if (total > 1 && post.media.length !== total) {
    const items = await Promise.allSettled(Array.from({ length: total }, (_, k) => get(`${OGINSTAGRAM}/api/v1/statuses/${ogStatusId(ref, k + 1)}`)));
    if (items.every(r => r.status === 'fulfilled')) {
      const media = items.flatMap(r => statusMedia((r as PromiseFulfilledResult<MastoStatus>).value).slice(0, 1));
      if (media.length === total) post.media = media;
    }
  }
  return post;
}

/** yt-dlp's take on a post: the video, downloaded and sized to fit. `first` is what Instaloader said if it had already failed. */
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
 * The post for an Instagram link, ready to send: OGInstagram answers it (or, failing that, Instaloader reads it) and nothing is
 * downloaded here, so the card can go out at once with the media as links (see sendRepostFast). yt-dlp is only asked when neither
 * can read the post; its result comes with the video already downloaded.
 */
export async function instagramRepost(link: string, o: { maxBytes: number; ytdlpRun?: Runner; scriptRun?: ScriptRunner; statusGet?: StatusGet }): Promise<RepostPost> {
  const ref = instagramRef(link);
  if (ref) {
    const quick = await ogInstagramPost(ref, o.statusGet).catch(() => null);
    if (quick) return quick;
  }
  try {
    return await fetchInstagramPost(link, o.scriptRun);
  } catch (err) {
    // Not installed: yt-dlp is all there is, and its errors are the ones to show. Otherwise Instaloader's answer is kept for the message.
    return viaYtdlp(link, o, err instanceof InstaloaderMissing ? undefined : err);
  }
}
