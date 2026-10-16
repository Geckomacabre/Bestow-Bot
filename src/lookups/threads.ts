import he from 'he';
import { LookupError } from './handler.js';
import type { RepostMedia, RepostPost } from './repost.js';

/**
 * Threads posts, read from the post's own page: Threads embeds the post's data as JSON in it (<script type="application/json"
 * data-sjs>) — the caption, the author, likes, replies, reposts, quotes, when it was posted, and the photos and videos. When that
 * isn't there, the page's Open Graph tags give the author and the text. Threads has no public API and no working embed fixer, and it
 * sometimes shows servers a login page instead, so this is best effort.
 */

export const THREADS_COLOR = 0x101010;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

/** The post's code (and author, when the link has it) in a Threads link; null for anything else. */
export function parseThreadsUrl(link: string): { user?: string; code: string } | null {
  let u: URL;
  try { u = new URL(link.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || !/^(?:www\.)?threads\.(?:net|com)$/i.test(u.hostname)) return null;
  const m = /^\/@([\w.]{1,30})\/post\/([\w-]{5,40})(?:\/media)?\/?$/.exec(u.pathname);
  if (m) return { user: m[1]!, code: m[2]! };
  const t = /^\/t\/([\w-]{5,40})\/?$/.exec(u.pathname);
  return t ? { code: t[1]! } : null;
}

interface Candidate { url?: string; width?: number }
/** What the card uses of a post in the page's data (Threads' "media" objects). */
export interface ThreadsMedia {
  code?: string; taken_at?: number; like_count?: number;
  caption?: { text?: string } | null;
  text_post_app_info?: { direct_reply_count?: number; repost_count?: number; quote_count?: number } | null;
  user?: { username?: string; full_name?: string; profile_pic_url?: string; is_verified?: boolean } | null;
  image_versions2?: { candidates?: Candidate[] } | null;
  video_versions?: { url?: string }[] | null;
  carousel_media?: ThreadsMedia[] | null;
}

/** The first object (depth first) in a JSON tree that passes `test`; gives up after `budget` objects. */
function findObject(root: unknown, test: (o: Record<string, unknown>) => boolean, budget = 200_000): Record<string, unknown> | null {
  const stack: unknown[] = [root];
  while (stack.length && budget-- > 0) {
    const v = stack.pop();
    if (!v || typeof v !== 'object') continue;
    if (!Array.isArray(v) && test(v as Record<string, unknown>)) return v as Record<string, unknown>;
    for (const child of Array.isArray(v) ? v : Object.values(v)) if (child && typeof child === 'object') stack.push(child);
  }
  return null;
}

const biggest = (c?: Candidate[]) => [...(c ?? [])].filter(x => x.url?.startsWith('https://')).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url;

/** The photos and videos of a post (each item of a carousel). */
export function threadsMedia(p: ThreadsMedia): RepostMedia[] {
  const one = (m: ThreadsMedia): RepostMedia | null => {
    const video = m.video_versions?.find(v => v.url?.startsWith('https://'))?.url;
    const image = biggest(m.image_versions2?.candidates);
    return video ? { type: 'video', url: video, thumb: image } : image ? { type: 'image', url: image } : null;
  };
  const items = p.carousel_media?.length ? p.carousel_media.map(one) : [one(p)];
  return items.filter((m): m is RepostMedia => !!m).slice(0, 10);
}

/** A post from the page's data as a repost. */
export function threadsPost(p: ThreadsMedia, code: string): RepostPost | null {
  const handle = p.user?.username;
  if (!handle) return null;
  const info = p.text_post_app_info;
  return {
    site: 'Threads', color: THREADS_COLOR, url: `https://www.threads.com/@${handle}/post/${code}`,
    author: { name: p.user?.full_name?.trim() || handle, handle, avatar: p.user?.profile_pic_url || undefined, url: `https://www.threads.com/@${handle}`, verified: p.user?.is_verified || undefined },
    text: p.caption?.text?.trim() || undefined, createdAt: p.taken_at ? p.taken_at * 1000 : undefined,
    stats: [{ icon: '♡', value: p.like_count }, { icon: '💬', value: info?.direct_reply_count }, { icon: '🔁', value: info?.repost_count }, { icon: '', value: info?.quote_count || null, suffix: ' quotes' }],
    media: threadsMedia(p),
  };
}

const meta = (html: string, key: string) =>
  he.decode(new RegExp(`<meta[^>]+(?:property|name)="${key}"[^>]+content="([^"]*)"`, 'i').exec(html)?.[1] ?? new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${key}"`, 'i').exec(html)?.[1] ?? '');

/** A Threads page as a repost: the post in its data, or else its Open Graph tags. Null if it has neither. */
export function threadsFromPage(html: string, ref: { user?: string; code: string }): RepostPost | null {
  for (const m of html.matchAll(/<script\b(?=[^>]*\bdata-sjs\b)(?=[^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/g)) {
    let data: unknown;
    try { data = JSON.parse(m[1]!); } catch { continue; }
    const found = findObject(data, o => o.code === ref.code && ('caption' in o || 'like_count' in o || 'taken_at' in o));
    const post = found && threadsPost(found as ThreadsMedia, ref.code);
    if (post) return post;
  }
  const title = meta(html, 'og:title');
  const who = /^(.*?)\s*\(@([\w.]+)\) on Threads$/.exec(title) ?? /^@([\w.]+) on Threads$/.exec(title);
  if (!who) return null;
  const handle = who[2] ?? who[1]!, name = who[2] ? who[1]! : handle;
  const media: RepostMedia[] = [];
  const video = meta(html, 'og:video'), image = meta(html, 'og:image');
  if (video.startsWith('https://')) media.push({ type: 'video', url: video });
  // A text post's preview image is the author's picture; a post with a photo says so with a large card.
  else if (image.startsWith('https://') && meta(html, 'twitter:card') === 'summary_large_image') media.push({ type: 'image', url: image });
  return {
    site: 'Threads', color: THREADS_COLOR, url: `https://www.threads.com/@${handle}/post/${ref.code}`,
    author: { name: name || handle, handle, url: `https://www.threads.com/@${handle}` }, text: meta(html, 'og:description') || undefined,
    stats: [], media,
  };
}

/** Fetches a page: its HTML and the address it ended up at. Tests replace it. */
export type ThreadsGet = (url: string) => Promise<{ html: string; url: string }>;
const defaultGet: ThreadsGet = async url => {
  const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new LookupError(res.status === 404 ? 'That Threads post doesn\'t exist.' : `Threads answered with an error (${res.status}).`);
  return { html: await res.text(), url: res.url };
};

/** The post a Threads link points to. */
export async function threadsRepost(link: string, get: ThreadsGet = defaultGet): Promise<RepostPost> {
  const ref = parseThreadsUrl(link);
  if (!ref) throw new LookupError('Send a Threads post link like `https://www.threads.com/@user/post/…`.');
  const page = await get(ref.user ? `https://www.threads.com/@${ref.user}/post/${ref.code}` : `https://www.threads.com/t/${ref.code}`);
  if (/\/login|\/accounts\/login/.test(new URL(page.url).pathname)) throw new LookupError('Threads wants a login to show that post right now — it may be private, or Threads is turning the bot away.');
  const post = threadsFromPage(page.html, ref);
  if (!post) throw new LookupError('I couldn\'t read that Threads post. It may have been deleted.');
  return post;
}
