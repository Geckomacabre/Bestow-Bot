import { getJson, postJson } from '../framework/http.js';
import { LookupError } from './handler.js';

/** Twitch Helix with an app access token (TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET from dev.twitch.tv — free). */

let token: { value: string; until: number } | null = null;

async function appToken(): Promise<string> {
  const id = Bun.env.TWITCH_CLIENT_ID, secret = Bun.env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) throw new LookupError('Twitch lookups need a Twitch app (TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET), which the bot owner hasn\'t set.');
  if (token && token.until > Date.now() + 60_000) return token.value;
  const r = await postJson<{ access_token: string; expires_in: number }>(`https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}&grant_type=client_credentials`, {});
  token = { value: r.access_token, until: Date.now() + r.expires_in * 1000 };
  return token.value;
}

async function helix<T>(path: string): Promise<T> {
  return getJson<T>(`https://api.twitch.tv/helix/${path}`, { headers: { 'Client-ID': Bun.env.TWITCH_CLIENT_ID!, Authorization: `Bearer ${await appToken()}` }, cacheMs: 60_000 });
}

export const cleanLogin = (s: string) => {
  const h = s.trim().replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '').replace(/^@/, '').split(/[/?#]/)[0]!.toLowerCase();
  if (!/^[a-z0-9_]{3,25}$/.test(h)) throw new LookupError('That isn\'t a valid Twitch username.');
  return h;
};

export interface TwitchUser { id: string; login: string; name: string; description?: string; avatar?: string; offlineImage?: string; created: string; type: string; followers?: number; game?: string; title?: string }

export async function twitchUser(input: string): Promise<TwitchUser> {
  const login = cleanLogin(input);
  const u = (await helix<{ data: { id: string; login: string; display_name: string; description: string; profile_image_url: string; offline_image_url: string; created_at: string; broadcaster_type: string }[] }>(`users?login=${login}`)).data[0];
  if (!u) throw new LookupError(`There's no Twitch account called **${login}**.`);
  const [followers, channel] = await Promise.all([
    helix<{ total: number }>(`channels/followers?broadcaster_id=${u.id}&first=1`).then(r => r.total).catch(() => undefined),
    helix<{ data: { game_name: string; title: string }[] }>(`channels?broadcaster_id=${u.id}`).then(r => r.data[0]).catch(() => undefined),
  ]);
  return { id: u.id, login: u.login, name: u.display_name, description: u.description || undefined, avatar: u.profile_image_url, offlineImage: u.offline_image_url || undefined, created: u.created_at,
    type: u.broadcaster_type === 'partner' ? 'Partner' : u.broadcaster_type === 'affiliate' ? 'Affiliate' : 'Streamer', followers, game: channel?.game_name || undefined, title: channel?.title || undefined };
}

export interface TwitchStream { user: string; login: string; title: string; game?: string; viewers: number; started: string; thumbnail: string; tags: string[] }

export async function twitchLive(input: string): Promise<TwitchStream | null> {
  const login = cleanLogin(input);
  const s = (await helix<{ data: { user_name: string; user_login: string; title: string; game_name: string; viewer_count: number; started_at: string; thumbnail_url: string; tags?: string[] }[] }>(`streams?user_login=${login}`)).data[0];
  if (!s) return null;
  return { user: s.user_name, login: s.user_login, title: s.title, game: s.game_name || undefined, viewers: s.viewer_count, started: s.started_at,
    thumbnail: `${s.thumbnail_url.replace('{width}', '1280').replace('{height}', '720')}?t=${Math.floor(Date.now() / 60_000)}`, tags: s.tags ?? [] };
}
