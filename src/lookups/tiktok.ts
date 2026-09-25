import { getJson } from '../framework/http.js';
import { withLock } from '../framework/mutex.js';
import { LookupError } from './handler.js';
import type { RepostPost } from './repost.js';

/**
 * TikTok via TikWM's public API (no key): watermark-free video, photo posts, the sound, stats, profiles and recent posts.
 * TikWM allows about one request a second, so calls are serialised.
 */

export const TIKTOK_PINK = 0xfe2c55;
const API = 'https://www.tikwm.com/api';
const abs = (u?: string) => (!u ? undefined : u.startsWith('http') ? u : `https://www.tikwm.com${u.startsWith('/') ? '' : '/'}${u}`);

let last = 0;
async function call<T>(path: string): Promise<T> {
  return withLock('tikwm', async () => {
    const wait = last + 1100 - Date.now();
    if (wait > 0) await Bun.sleep(wait);
    try {
      const r = await getJson<{ code: number; msg?: string; data?: T }>(`${API}${path}`, { timeoutMs: 20_000, cacheMs: 2 * 60_000 });
      if (r.code !== 0 || !r.data) throw new LookupError(/private|not ?exist|not found|invalid/i.test(r.msg ?? '') ? 'That TikTok account or post doesn\'t exist, or it\'s private.' : 'TikTok didn\'t return that — it may be private or removed.');
      return r.data;
    } finally { last = Date.now(); }
  });
}

export function parseTikTokUrl(input: string): string {
  let u: URL;
  try { u = new URL(input.trim()); } catch { throw new LookupError('Send a TikTok link like `https://www.tiktok.com/@user/video/123…` or `https://vm.tiktok.com/…`.'); }
  if (u.protocol !== 'https:' || !/(^|\.)tiktok\.com$/i.test(u.hostname)) throw new LookupError('That isn\'t a TikTok link.');
  return u.toString();
}

export const cleanUser = (s: string) => {
  const h = s.trim().replace(/^https?:\/\/(www\.)?tiktok\.com\/@/i, '').replace(/^@/, '').split(/[/?#]/)[0]!;
  if (!/^[\w.]{2,24}$/.test(h)) throw new LookupError('That isn\'t a valid TikTok username.');
  return h;
};

export interface TikRaw {
  id: string; title?: string; play?: string; hdplay?: string; wmplay?: string; images?: string[]; cover?: string;
  music?: string; music_info?: { title?: string; author?: string; play?: string; cover?: string; original?: boolean };
  play_count?: number; digg_count?: number; comment_count?: number; share_count?: number; collect_count?: number; create_time?: number;
  author?: { unique_id?: string; nickname?: string; avatar?: string };
}

export function parseTikPost(d: TikRaw, url: string): RepostPost {
  const handle = d.author?.unique_id;
  const media = d.images?.length
    ? d.images.slice(0, 10).map(u => ({ type: 'image' as const, url: abs(u)! }))
    : [{ type: 'video' as const, url: abs(d.hdplay || d.play)!, thumb: abs(d.cover) }].filter(m => !!m.url);
  return {
    site: 'TikTok', color: TIKTOK_PINK, url: handle ? `https://www.tiktok.com/@${handle}/video/${d.id}` : url,
    author: { name: d.author?.nickname || handle || 'TikTok user', handle, avatar: abs(d.author?.avatar), url: handle ? `https://www.tiktok.com/@${handle}` : undefined },
    text: d.title, createdAt: d.create_time ? d.create_time * 1000 : undefined,
    stats: [{ icon: '♡', value: d.digg_count }, { icon: '💬', value: d.comment_count }, { icon: '🔖', value: d.collect_count }, { icon: '↗️', value: d.share_count }, { icon: '', value: d.play_count, suffix: ' views' }],
    media,
  };
}

export async function tiktokPost(link: string): Promise<{ post: RepostPost; sound?: { title: string; author: string; url: string; cover?: string } }> {
  const url = parseTikTokUrl(link);
  const d = await call<TikRaw>(`/?url=${encodeURIComponent(url)}&hd=1`);
  const m = d.music_info;
  const soundUrl = abs(m?.play || d.music);
  return { post: parseTikPost(d, url), sound: soundUrl ? { title: m?.title || 'original sound', author: m?.author || d.author?.nickname || '', url: soundUrl, cover: abs(m?.cover) } : undefined };
}

export interface TikUser {
  handle: string; name: string; avatar?: string; bio?: string; verified: boolean; private: boolean; link?: string;
  followers?: number; following?: number; likes?: number; videos?: number; friends?: number;
}

export function parseTikUser(d: { user?: { uniqueId?: string; nickname?: string; avatarLarger?: string; avatarMedium?: string; signature?: string; verified?: boolean; privateAccount?: boolean; bioLink?: { link?: string } }; stats?: { followerCount?: number; followingCount?: number; heartCount?: number; heart?: number; videoCount?: number; friendCount?: number } }): TikUser | null {
  const u = d.user;
  if (!u?.uniqueId) return null;
  return {
    handle: u.uniqueId, name: u.nickname || u.uniqueId, avatar: u.avatarLarger || u.avatarMedium, bio: u.signature || undefined, verified: !!u.verified, private: !!u.privateAccount, link: u.bioLink?.link,
    followers: d.stats?.followerCount, following: d.stats?.followingCount, likes: d.stats?.heartCount ?? d.stats?.heart, videos: d.stats?.videoCount, friends: d.stats?.friendCount,
  };
}

export async function tiktokUser(input: string): Promise<TikUser> {
  const u = parseTikUser(await call(`/user/info?unique_id=${encodeURIComponent(cleanUser(input))}`));
  if (!u) throw new LookupError('That TikTok account doesn\'t exist.');
  return u;
}

export interface TikListItem { id: string; title: string; cover?: string; plays?: number; likes?: number; comments?: number; created?: number; url: string }

export async function tiktokPosts(input: string, count = 20): Promise<TikListItem[]> {
  const handle = cleanUser(input);
  const d = await call<{ videos?: (TikRaw & { video_id?: string })[] }>(`/user/posts?unique_id=${encodeURIComponent(handle)}&count=${Math.min(40, Math.max(1, count))}&cursor=0`);
  return (d.videos ?? []).map(v => ({
    id: v.video_id ?? v.id, title: v.title || '(no caption)', cover: abs(v.cover), plays: v.play_count, likes: v.digg_count, comments: v.comment_count,
    created: v.create_time ? v.create_time * 1000 : undefined, url: `https://www.tiktok.com/@${handle}/video/${v.video_id ?? v.id}`,
  }));
}
