import { getJson, HttpError, USER_AGENT } from '../framework/http.js';
import { LookupError } from './handler.js';
import type { RepostMedia, RepostPost } from './repost.js';

/**
 * Reddit posts from Reddit's own JSON: the title and text, the subreddit and author, when it was posted, score, comments and media
 * (photos, galleries, GIFs and videos). Reddit turns away many servers that ask without an app, so with REDDIT_CLIENT_ID and
 * REDDIT_CLIENT_SECRET (a free "script" app from https://www.reddit.com/prefs/apps) it is asked through OAuth instead.
 * A Reddit video keeps its sound in a separate stream, so one with sound is best downloaded by yt-dlp, which joins the two (`needsDownload`).
 */

export const REDDIT_ORANGE = 0xff4500;
const HOST = /^(?:(?:www|old|new|np|m|sh|i)\.)?reddit\.com$/i;

/** A post link's id (or, for a share link, the link to follow); null for anything else. */
export function parseRedditUrl(link: string): { id: string } | { share: string } | null {
  let u: URL;
  try { u = new URL(link.trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (host === 'redd.it' || host === 'www.redd.it') { const id = /^\/([a-z0-9]{4,10})\/?$/i.exec(u.pathname)?.[1]; return id ? { id: id.toLowerCase() } : null; }
  if (!HOST.test(host)) return null;
  const id = /^\/(?:(?:r|u|user)\/[\w-]+\/)?(?:comments|gallery)\/([a-z0-9]{4,10})(?:\/|$)/i.exec(u.pathname)?.[1];
  if (id) return { id: id.toLowerCase() };
  if (/^\/r\/[\w-]+\/s\/[\w-]+\/?$/.test(u.pathname)) return { share: `https://www.reddit.com${u.pathname}` };
  return null;
}

interface MediaMeta { e?: string; m?: string; s?: { u?: string; gif?: string; mp4?: string } }
export interface RedditPostData {
  id: string; title?: string; selftext?: string; author?: string; subreddit?: string; permalink?: string; url?: string; created_utc?: number;
  score?: number; num_comments?: number; over_18?: boolean; spoiler?: boolean; post_hint?: string; is_video?: boolean; is_self?: boolean;
  media?: { reddit_video?: { fallback_url?: string; has_audio?: boolean } } | null;
  secure_media?: RedditPostData['media'];
  preview?: { images?: { source?: { url?: string }; variants?: { mp4?: { source?: { url?: string } } } }[]; reddit_video_preview?: { fallback_url?: string } };
  is_gallery?: boolean; gallery_data?: { items?: { media_id: string }[] }; media_metadata?: Record<string, MediaMeta>;
  crosspost_parent_list?: RedditPostData[];
}

/** The post's media, and whether it is a video with sound (which only a download can keep). */
export function redditMedia(d: RedditPostData): { media: RepostMedia[]; needsDownload: boolean } {
  const src = d.crosspost_parent_list?.[0] ?? d;
  const video = (src.secure_media ?? src.media)?.reddit_video;
  if (src.is_video && video?.fallback_url) {
    // The silent stream is kept either way: it's what is shown if the download with sound can't be made.
    return { media: [{ type: 'video', url: video.fallback_url }], needsDownload: video.has_audio !== false };
  }
  if (src.is_gallery && src.gallery_data?.items?.length) {
    const media = src.gallery_data.items.slice(0, 10).flatMap(({ media_id }): RepostMedia[] => {
      const m = src.media_metadata?.[media_id];
      if (m?.e === 'AnimatedImage' && m.s?.mp4) return [{ type: 'gif', url: m.s.mp4 }];
      const url = m?.s?.gif ?? m?.s?.u;
      return url ? [{ type: 'image', url }] : [];
    });
    return { media, needsDownload: false };
  }
  const img = src.preview?.images?.[0];
  const gif = img?.variants?.mp4?.source?.url ?? src.preview?.reddit_video_preview?.fallback_url;
  if (gif && /\.gif(\?|$)/i.test(src.url ?? '')) return { media: [{ type: 'gif', url: gif }], needsDownload: false };
  if (src.post_hint === 'image' && src.url && /^https:\/\/(i\.redd\.it|i\.imgur\.com)\//.test(src.url)) return { media: [{ type: 'image', url: src.url }], needsDownload: false };
  if (img?.source?.url && src.post_hint !== 'self') return { media: [{ type: 'image', url: img.source.url }], needsDownload: false }; // a link's preview
  return { media: [], needsDownload: false };
}

/** A post as a repost. */
export function redditPost(d: RedditPostData): RepostPost & { needsDownload: boolean } {
  const { media, needsDownload } = redditMedia(d);
  const link = !d.is_self && d.url && !/^https:\/\/(www\.|i\.|v\.)?(reddit\.com|redd\.it)\//.test(d.url) && !media.some(m => m.url === d.url) ? d.url : null;
  const text = [d.title ? `**${d.title.trim()}**` : null, d.selftext?.trim() || null, link].filter(Boolean).join('\n\n');
  const author = d.author && d.author !== '[deleted]' ? d.author : null;
  return {
    site: 'Reddit', color: REDDIT_ORANGE, url: `https://www.reddit.com${d.permalink ?? `/comments/${d.id}/`}`,
    author: { name: d.subreddit ? `r/${d.subreddit}` : 'Reddit', byline: author ? `u/${author}` : 'u/[deleted]', url: author ? `https://www.reddit.com/user/${author}/` : undefined },
    text: text || undefined, createdAt: d.created_utc ? d.created_utc * 1000 : undefined,
    stats: [{ icon: '⬆️', value: d.score }, { icon: '💬', value: d.num_comments }],
    media, sensitive: !!(d.over_18 || d.spoiler) || undefined, needsDownload,
  };
}

/** Reddit's JSON (or OAuth JSON) for a path. Tests replace it. */
export type RedditGet = (path: string) => Promise<unknown>;

let token: { value: string; until: number } | null = null;

/** An app-only OAuth token when REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET are set; null otherwise. */
async function oauthToken(): Promise<string | null> {
  const id = Bun.env.REDDIT_CLIENT_ID, secret = Bun.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (token && token.until > Date.now()) return token.value;
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST', body: 'grant_type=client_credentials', signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new HttpError(res.status, 'https://www.reddit.com/api/v1/access_token');
  const j = await res.json() as { access_token?: string; expires_in?: number };
  if (!j.access_token) return null;
  token = { value: j.access_token, until: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 60) * 1000 };
  return token.value;
}

const defaultGet: RedditGet = async path => {
  const bearer = await oauthToken();
  if (bearer) return getJson(`https://oauth.reddit.com${path}`, { cacheMs: 2 * 60_000, timeoutMs: 10_000, headers: { Authorization: `Bearer ${bearer}` } });
  const [route, query] = path.split('?');
  return getJson(`https://www.reddit.com${route}.json${query ? `?${query}` : ''}`, { cacheMs: 2 * 60_000, timeoutMs: 10_000 });
};

/** Where a share link (/r/sub/s/…) leads: Reddit answers it with a redirect to the post. */
async function followShare(url: string): Promise<string | null> {
  const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8_000) });
  void res.body?.cancel();
  return res.headers.get('location');
}

/** The post a Reddit link points to. `needsDownload` is set for a video with sound. */
export async function redditRepost(link: string, o: { get?: RedditGet; follow?: (url: string) => Promise<string | null> } = {}): Promise<RepostPost & { needsDownload: boolean }> {
  let ref = parseRedditUrl(link);
  if (ref && 'share' in ref) {
    const to = await (o.follow ?? followShare)(ref.share).catch(() => null);
    ref = to ? parseRedditUrl(new URL(to, 'https://www.reddit.com').toString()) : null;
    if (!ref || 'share' in ref) throw new LookupError('I couldn\'t open that Reddit share link.');
  }
  if (!ref) throw new LookupError('Send a Reddit post link like `https://www.reddit.com/r/…/comments/…`.');
  let listing: unknown;
  try { listing = await (o.get ?? defaultGet)(`/comments/${ref.id}?raw_json=1&limit=1`); }
  catch (e) {
    if (e instanceof HttpError && e.status === 404) throw new LookupError('That Reddit post doesn\'t exist.');
    if (e instanceof HttpError && e.status === 403) throw new LookupError('Reddit turned me away (it blocks many servers). The bot owner can set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET to fix that.');
    throw e;
  }
  const d = (listing as { data?: { children?: { data?: RedditPostData }[] } }[])?.[0]?.data?.children?.[0]?.data;
  if (!d?.id) throw new LookupError('That Reddit post doesn\'t exist, or it\'s been removed.');
  return redditPost(d);
}
