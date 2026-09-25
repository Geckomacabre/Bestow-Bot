import { getJson, HttpError } from '../framework/http.js';
import { LookupError } from './handler.js';
import type { RepostPost } from './repost.js';
import { parseTweetUrl, tweet as vxTweet } from './web.js';

/** X/Twitter via the public FxTwitter API (no key): full stats incl. views and bookmarks, and profile info. vxtwitter is the fallback. */

export const X_BLUE = 0x1d9bf0;

interface FxMedia { type: 'photo' | 'video' | 'gif'; url: string; thumbnail_url?: string }
interface FxAuthor { name: string; screen_name: string; avatar_url?: string; verification?: { verified?: boolean; type?: string } | null }
export interface FxTweetRaw {
  code?: number;
  tweet?: {
    url: string; text: string; author: FxAuthor; replies?: number; retweets?: number; likes?: number; bookmarks?: number; views?: number | null;
    created_timestamp?: number; possibly_sensitive?: boolean; media?: { all?: FxMedia[] } | null;
  };
}

/** t.co links at the end of a post that just point at its own media. */
export const stripMediaLinks = (text: string, hasMedia: boolean) => (hasMedia ? text.replace(/(\s*https:\/\/t\.co\/\w+)+\s*$/, '') : text).trim();

export function parseFxTweet(raw: FxTweetRaw): RepostPost | null {
  const t = raw.tweet;
  if (!t) return null;
  const media = (t.media?.all ?? []).filter(m => /^https:\/\//.test(m.url)).map(m => ({ type: m.type === 'photo' ? 'image' as const : m.type === 'gif' ? 'gif' as const : 'video' as const, url: m.url, thumb: m.thumbnail_url }));
  return {
    site: 'X', color: X_BLUE, url: t.url,
    author: { name: t.author.name, handle: t.author.screen_name, avatar: t.author.avatar_url?.replace('_normal.', '_400x400.'), url: `https://x.com/${t.author.screen_name}`, verified: !!t.author.verification?.verified },
    text: stripMediaLinks(t.text ?? '', media.length > 0), createdAt: t.created_timestamp ? t.created_timestamp * 1000 : undefined,
    stats: [{ icon: '♡', value: t.likes }, { icon: '💬', value: t.replies }, { icon: '🔖', value: t.bookmarks }, { icon: '🔁', value: t.retweets }, { icon: '', value: t.views ?? null, suffix: ' views' }],
    media, sensitive: !!t.possibly_sensitive,
  };
}

export async function xPost(link: string): Promise<RepostPost> {
  const { user, id } = parseTweetUrl(link);
  try {
    const p = parseFxTweet(await getJson<FxTweetRaw>(`https://api.fxtwitter.com/${user}/status/${id}`, { cacheMs: 5 * 60_000, timeoutMs: 15_000 }));
    if (p) return p;
  } catch (e) { if (e instanceof HttpError && e.status === 404) throw new LookupError('That post doesn\'t exist, or it\'s from a private account.'); }
  const v = await vxTweet(link);
  return {
    site: 'X', color: X_BLUE, url: v.url, author: { name: v.user, handle: v.handle, avatar: v.avatar, url: `https://x.com/${v.handle}` },
    text: stripMediaLinks(v.text, v.media.length > 0), createdAt: Date.parse(v.date) || undefined,
    stats: [{ icon: '♡', value: v.likes }, { icon: '💬', value: v.replies }, { icon: '🔁', value: v.retweets }],
    media: v.media.map(m => ({ type: m.type === 'image' ? 'image' : m.type === 'gif' ? 'gif' : 'video', url: m.url })), sensitive: v.sensitive,
  };
}

export interface XUser {
  name: string; handle: string; description?: string; location?: string; website?: string; avatar?: string; banner?: string;
  followers?: number; following?: number; posts?: number; likes?: number; media?: number; joined?: number; verified: boolean; protected: boolean;
}

interface FxUserRaw {
  code?: number;
  user?: {
    screen_name: string; name: string; description?: string; location?: string; avatar_url?: string; banner_url?: string; followers?: number; following?: number;
    tweets?: number; likes?: number; media_count?: number; joined?: string; website?: { url?: string; display_url?: string } | null;
    verification?: { verified?: boolean } | null; protected?: boolean;
  };
}

export function parseFxUser(raw: FxUserRaw): XUser | null {
  const u = raw.user;
  if (!u?.screen_name) return null;
  return {
    name: u.name, handle: u.screen_name, description: u.description || undefined, location: u.location || undefined, website: u.website?.url || undefined,
    avatar: u.avatar_url?.replace('_normal.', '_400x400.'), banner: u.banner_url || undefined, followers: u.followers, following: u.following, posts: u.tweets, likes: u.likes, media: u.media_count,
    joined: u.joined ? Date.parse(u.joined) || undefined : undefined, verified: !!u.verification?.verified, protected: !!u.protected,
  };
}

export async function xUser(input: string): Promise<XUser> {
  const handle = input.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '').split(/[/?#]/)[0]!;
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new LookupError('That isn\'t a valid X username.');
  let raw: FxUserRaw;
  try { raw = await getJson<FxUserRaw>(`https://api.fxtwitter.com/${handle}`, { cacheMs: 5 * 60_000, timeoutMs: 15_000 }); }
  catch (e) { if (e instanceof HttpError && e.status === 404) throw new LookupError(`There's no X account called **@${handle}** (or it's suspended).`); throw e; }
  const u = parseFxUser(raw);
  if (!u) throw new LookupError(`There's no X account called **@${handle}** (or it's suspended).`);
  return u;
}
