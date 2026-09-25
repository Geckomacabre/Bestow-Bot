import { createHash } from 'node:crypto';
import { getJson, HttpError, USER_AGENT } from '../framework/http.js';
import { LookupError } from '../lookups/handler.js';
import { db } from '../utils/db.js';

/**
 * Last.fm. LASTFM_API_KEY (free at last.fm/api/account/create) for everything; LASTFM_API_SECRET as well for signed calls —
 * the proper login flow and love/unlove. Linked accounts are stored as username (+ session key when logged in properly).
 */

const API = 'https://ws.audioscrobbler.com/2.0/';
export const LASTFM_RED = 0xd51007;
export const lastfmKey = () => Bun.env.LASTFM_API_KEY || null;
export const lastfmSecret = () => Bun.env.LASTFM_API_SECRET || null;

export async function initLastfmSchema(): Promise<void> {
  await db`CREATE TABLE IF NOT EXISTS lastfm_users (
    user_id     TEXT PRIMARY KEY,
    username    TEXT NOT NULL,
    session_key TEXT,
    np_style    TEXT NOT NULL DEFAULT 'default',
    np_canvas   INTEGER NOT NULL DEFAULT 0,
    linked_at   INTEGER NOT NULL
  )`;
}

export interface LinkedUser { user_id: string; username: string; session_key: string | null; np_style: string; np_canvas: number; linked_at: number }

export async function linked(userId: string): Promise<LinkedUser | null> {
  return ((await db`SELECT * FROM lastfm_users WHERE user_id = ${userId}`) as LinkedUser[])[0] ?? null;
}
export async function link(userId: string, username: string, sessionKey: string | null, now = Date.now()): Promise<void> {
  await db`INSERT INTO lastfm_users (user_id, username, session_key, linked_at) VALUES (${userId}, ${username}, ${sessionKey}, ${now})
    ON CONFLICT (user_id) DO UPDATE SET username = ${username}, session_key = ${sessionKey}, linked_at = ${now}`;
}
export async function unlink(userId: string): Promise<boolean> {
  return ((await db`DELETE FROM lastfm_users WHERE user_id = ${userId} RETURNING 1`) as unknown[]).length > 0;
}
export async function setNpStyle(userId: string, style: string, canvas: boolean): Promise<boolean> {
  return ((await db`UPDATE lastfm_users SET np_style = ${style}, np_canvas = ${canvas ? 1 : 0} WHERE user_id = ${userId} RETURNING 1`) as unknown[]).length > 0;
}

export const USERNAME_RE = /^[A-Za-z][\w-]{1,14}$/;

/** Signature for signed calls: md5 of the sorted params (name+value, no format/callback) followed by the secret. */
export function sign(params: Record<string, string>, secret: string): string {
  const base = Object.keys(params).filter(k => k !== 'format' && k !== 'callback').sort().map(k => `${k}${params[k]}`).join('');
  return createHash('md5').update(base + secret, 'utf8').digest('hex');
}

export class LastfmError extends LookupError {}
const ERRORS: Record<number, string> = { 6: 'That Last.fm user or item doesn\'t exist.', 17: 'That Last.fm profile is private.', 29: 'Last.fm is rate-limiting me — try again in a minute.', 9: 'Your Last.fm login expired — run /lastfm login again.', 14: 'You haven\'t approved Bestow on Last.fm yet.' };

async function call<T>(method: string, params: Record<string, string>, o: { signed?: boolean; post?: boolean; cacheMs?: number } = {}): Promise<T> {
  const key = lastfmKey();
  if (!key) throw new LastfmError('Last.fm isn\'t set up on this bot (LASTFM_API_KEY).');
  const p: Record<string, string> = { ...params, method, api_key: key };
  if (o.signed) {
    const secret = lastfmSecret();
    if (!secret) throw new LastfmError('This needs the bot owner to set LASTFM_API_SECRET.');
    p.api_sig = sign(p, secret);
  }
  p.format = 'json';
  const qs = new URLSearchParams(p);
  let r: T & { error?: number; message?: string };
  try {
    if (o.post) {
      const res = await fetch(API, { method: 'POST', body: qs, headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15_000) });
      r = (await res.json()) as T & { error?: number; message?: string };
    } else {
      r = await getJson(`${API}?${qs}`, { cacheMs: o.cacheMs ?? 30_000, timeoutMs: 15_000 });
    }
  } catch (e) {
    if (e instanceof HttpError) {
      const body = e.status === 404 ? 6 : e.status === 429 ? 29 : 0;
      throw new LastfmError(ERRORS[body] ?? 'Last.fm didn\'t answer — try again.');
    }
    throw e;
  }
  if (r.error) throw new LastfmError(ERRORS[r.error] ?? `Last.fm: ${r.message ?? 'error'}`);
  return r;
}

// ─── Login ───────────────────────────────────────────────────────────────────

export async function authToken(): Promise<{ token: string; url: string }> {
  const r = await call<{ token: string }>('auth.getToken', {}, { signed: true, cacheMs: 0 });
  return { token: r.token, url: `https://www.last.fm/api/auth/?api_key=${lastfmKey()}&token=${r.token}` };
}
export async function sessionFor(token: string): Promise<{ username: string; key: string }> {
  const r = await call<{ session: { name: string; key: string } }>('auth.getSession', { token }, { signed: true, cacheMs: 0 });
  return { username: r.session.name, key: r.session.key };
}

// ─── Reads ───────────────────────────────────────────────────────────────────

type Img = { '#text': string; size: string }[];
export const bestImage = (img?: Img) => {
  const url = [...(img ?? [])].reverse().find(i => i['#text'])?.['#text'];
  // Last.fm returns this grey star placeholder when there's no art.
  return url && !url.includes('2a96cbd8b46e442fc41c2b86b821562f') ? url : undefined;
};

export interface Track { name: string; artist: string; album?: string; image?: string; url: string; nowPlaying: boolean; date?: number; loved?: boolean }

interface RawTrack { name: string; artist: { '#text'?: string; name?: string }; album?: { '#text': string }; image?: Img; url: string; date?: { uts: string }; loved?: string; '@attr'?: { nowplaying?: string } }
interface RecentRaw { recenttracks: { track?: RawTrack[] | RawTrack; '@attr'?: { total?: string; user?: string } } }

export function parseRecent(r: RecentRaw): { tracks: Track[]; total: number } {
  // Last.fm returns a bare object instead of a one-item array when there's a single track.
  const t = r.recenttracks.track;
  const raw = Array.isArray(t) ? t : t && 'name' in t ? [t] : [];
  return {
    total: Number(r.recenttracks['@attr']?.total ?? 0),
    tracks: raw.map(t => ({
      name: t.name, artist: t.artist['#text'] ?? t.artist.name ?? '', album: t.album?.['#text'] || undefined, image: bestImage(t.image), url: t.url,
      nowPlaying: t['@attr']?.nowplaying === 'true', date: t.date ? Number(t.date.uts) * 1000 : undefined, loved: t.loved === '1',
    })),
  };
}

export async function recent(username: string, limit = 10, extra: Record<string, string> = {}): Promise<{ tracks: Track[]; total: number }> {
  return parseRecent(await call<RecentRaw>('user.getRecentTracks', { user: username, limit: String(limit), extended: '1', ...extra }, { cacheMs: 15_000 }));
}

export interface UserInfo { name: string; realname?: string; playcount: number; artists?: number; tracks?: number; albums?: number; registered?: number; image?: string; url: string; country?: string }
export async function userInfo(username: string): Promise<UserInfo> {
  const r = await call<{ user: { name: string; realname?: string; playcount: string; artist_count?: string; track_count?: string; album_count?: string; registered?: { unixtime: string }; image?: Img; url: string; country?: string } }>('user.getInfo', { user: username });
  const u = r.user;
  return { name: u.name, realname: u.realname || undefined, playcount: Number(u.playcount), artists: u.artist_count ? Number(u.artist_count) : undefined, tracks: u.track_count ? Number(u.track_count) : undefined,
    albums: u.album_count ? Number(u.album_count) : undefined, registered: u.registered ? Number(u.registered.unixtime) * 1000 : undefined, image: bestImage(u.image), url: u.url, country: u.country && u.country !== 'None' ? u.country : undefined };
}

export async function trackInfo(artist: string, track: string, username?: string): Promise<{ plays?: number; listeners?: number; userplays?: number; loved?: boolean; duration?: number; image?: string; album?: string; url?: string; tags: string[] }> {
  const r = await call<{ track: { listeners?: string; playcount?: string; userplaycount?: string; userloved?: string; duration?: string; url?: string; album?: { title?: string; image?: Img }; toptags?: { tag: { name: string }[] | { name: string } } } }>('track.getInfo', { artist, track, autocorrect: '1', ...(username ? { username } : {}) });
  const t = r.track;
  const tags = Array.isArray(t.toptags?.tag) ? t.toptags!.tag : t.toptags?.tag ? [t.toptags.tag as { name: string }] : [];
  return { plays: t.playcount ? Number(t.playcount) : undefined, listeners: t.listeners ? Number(t.listeners) : undefined, userplays: t.userplaycount != null ? Number(t.userplaycount) : undefined,
    loved: t.userloved === '1', duration: t.duration ? Number(t.duration) : undefined, image: bestImage(t.album?.image), album: t.album?.title, url: t.url, tags: tags.map(x => x.name).slice(0, 5) };
}

export async function artistPlays(artist: string, username: string): Promise<{ name: string; userplays: number; url: string; image?: string; listeners?: number }> {
  const r = await call<{ artist: { name: string; url: string; image?: Img; stats?: { userplaycount?: string; listeners?: string } } }>('artist.getInfo', { artist, username, autocorrect: '1' });
  return { name: r.artist.name, userplays: Number(r.artist.stats?.userplaycount ?? 0), url: r.artist.url, image: bestImage(r.artist.image), listeners: r.artist.stats?.listeners ? Number(r.artist.stats.listeners) : undefined };
}

export async function searchTrackArtist(track: string): Promise<string | null> {
  const r = await call<{ results?: { trackmatches?: { track?: { artist: string }[] } } }>('track.search', { track, limit: '1' });
  return r.results?.trackmatches?.track?.[0]?.artist ?? null;
}

export const PERIODS: Record<string, string> = { 'overall': 'overall', '7 days': '7day', '1 month': '1month', '3 months': '3month', '6 months': '6month', '12 months': '12month' };
export interface TopItem { name: string; artist?: string; plays: number; url: string; image?: string; rank: number }

type TopRaw = { '@attr'?: { rank?: string }; name: string; playcount: string; url: string; artist?: { name: string }; image?: Img };
export function parseTop(list: TopRaw[] | TopRaw | undefined): TopItem[] {
  const arr = Array.isArray(list) ? list : list ? [list] : [];
  return arr.map((x, n) => ({ name: x.name, artist: x.artist?.name, plays: Number(x.playcount), url: x.url, image: bestImage(x.image), rank: Number(x['@attr']?.rank ?? n + 1) }));
}

export async function top(kind: 'artists' | 'tracks' | 'albums', username: string, period = 'overall', limit = 10): Promise<TopItem[]> {
  const method = `user.getTop${kind[0]!.toUpperCase()}${kind.slice(1)}`;
  const r = await call<Record<string, Record<string, TopRaw[]>>>(method, { user: username, period: PERIODS[period] ?? period, limit: String(limit) });
  const key = `top${kind}`, inner = kind.slice(0, -1);
  return parseTop(r[key]?.[inner]);
}

export async function loved(username: string, limit = 10): Promise<{ tracks: Track[]; total: number }> {
  const r = await call<{ lovedtracks: { track: { name: string; artist: { name: string }; url: string; date?: { uts: string }; image?: Img }[]; '@attr'?: { total?: string } } }>('user.getLovedTracks', { user: username, limit: String(limit) });
  return { total: Number(r.lovedtracks['@attr']?.total ?? 0), tracks: (r.lovedtracks.track ?? []).map(t => ({ name: t.name, artist: t.artist.name, url: t.url, nowPlaying: false, date: t.date ? Number(t.date.uts) * 1000 : undefined, image: bestImage(t.image) })) };
}

/** A calendar year's totals and top artists/tracks/albums (weekly charts accept any from/to range). */
export async function yearStats(username: string, year: number) {
  const from = String(Date.UTC(year, 0, 1) / 1000), to = String(Date.UTC(year + 1, 0, 1) / 1000 - 1);
  const [scrobbles, artists, tracks, albums] = await Promise.all([
    recent(username, 1, { from, to }).then(r => r.total),
    call<{ weeklyartistchart: { artist: TopRaw[] } }>('user.getWeeklyArtistChart', { user: username, from, to }).then(r => parseTop(r.weeklyartistchart.artist).slice(0, 5)),
    call<{ weeklytrackchart: { track: TopRaw[] } }>('user.getWeeklyTrackChart', { user: username, from, to }).then(r => parseTop(r.weeklytrackchart.track).slice(0, 5)),
    call<{ weeklyalbumchart: { album: TopRaw[] } }>('user.getWeeklyAlbumChart', { user: username, from, to }).then(r => parseTop(r.weeklyalbumchart.album).slice(0, 5)),
  ]);
  return { scrobbles, artists, tracks, albums };
}

/** Shared artists between two top-artist lists, weighted by the smaller play count; score is 0–100. */
export function tasteScore(a: TopItem[], b: TopItem[]): { score: number; shared: { name: string; a: number; b: number }[] } {
  const mapB = new Map(b.map(x => [x.name.toLowerCase(), x.plays]));
  const shared = a.filter(x => mapB.has(x.name.toLowerCase())).map(x => ({ name: x.name, a: x.plays, b: mapB.get(x.name.toLowerCase())! })).sort((x, y) => Math.min(y.a, y.b) - Math.min(x.a, x.b));
  const denom = Math.min(a.length, b.length) || 1;
  return { score: Math.round((shared.length / denom) * 100), shared };
}

// ─── Writes (need a real login) ──────────────────────────────────────────────

export async function love(sessionKey: string, artist: string, track: string, on: boolean): Promise<void> {
  await call(on ? 'track.love' : 'track.unlove', { artist, track, sk: sessionKey }, { signed: true, post: true });
}

/** "Artist - Track" → both parts; a bare title keeps artist empty. */
export function splitTrack(s: string): { artist: string; track: string } {
  const m = /^\s*(.+?)\s+[-–—]\s+(.+?)\s*$/.exec(s);
  return m ? { artist: m[1]!, track: m[2]! } : { artist: '', track: s.trim() };
}
