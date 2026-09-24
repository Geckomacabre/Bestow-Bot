import { getJson, getBuffer, postJson, HttpError, USER_AGENT } from '../framework/http.js';
import { LookupError } from './handler.js';

/** Roblox public web APIs (no key). Some endpoints (badges, followers list, presence) need a login and are not used. */

const cache = 5 * 60_000;
export const ROBLOX_TAX = 0.3;
/** USD per Robux for the Developer Exchange. Roblox changes this occasionally — override with ROBLOX_DEVEX_RATE. */
export const devexRate = () => Number(Bun.env.ROBLOX_DEVEX_RATE ?? 0.0038);

export interface RbxUser {
  id: number; name: string; displayName: string; description?: string; created?: string; isBanned?: boolean; hasVerifiedBadge?: boolean;
}

export class RobloxNotFound extends LookupError {}

export async function userByName(name: string): Promise<RbxUser> {
  const r = await postJson<{ data: { id: number; name: string; displayName: string; hasVerifiedBadge?: boolean }[] }>(
    'https://users.roblox.com/v1/usernames/users', { usernames: [name.trim()], excludeBannedUsers: false }, { cacheMs: cache });
  const u = r.data?.[0];
  if (!u) throw new RobloxNotFound(`There's no Roblox user called **${name}**.`);
  return userById(u.id);
}

export async function userById(id: number): Promise<RbxUser> {
  try {
    return await getJson<RbxUser>(`https://users.roblox.com/v1/users/${id}`, { cacheMs: cache });
  } catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 400)) throw new RobloxNotFound(`There's no Roblox user with ID **${id}**.`);
    throw e;
  }
}

/** username (or numeric ID) → user. */
export async function resolveUser(input: string): Promise<RbxUser> {
  const s = input.trim().replace(/^@/, '');
  if (/^\d{1,12}$/.test(s) && Number(s) > 0 && s.length >= 3) {
    try { return await userById(Number(s)); } catch { /* maybe a numeric username */ }
  }
  return userByName(s);
}

export async function usersByIds(ids: number[]): Promise<{ id: number; name: string; displayName: string }[]> {
  if (!ids.length) return [];
  const r = await postJson<{ data: { id: number; name: string; displayName: string }[] }>('https://users.roblox.com/v1/users', { userIds: ids.slice(0, 100), excludeBannedUsers: false });
  return r.data ?? [];
}

export async function counts(id: number) {
  const [friends, followers, following] = await Promise.all([
    getJson<{ count: number }>(`https://friends.roblox.com/v1/users/${id}/friends/count`, { cacheMs: cache }).then(r => r.count).catch(() => null),
    getJson<{ count: number }>(`https://friends.roblox.com/v1/users/${id}/followers/count`, { cacheMs: cache }).then(r => r.count).catch(() => null),
    getJson<{ count: number }>(`https://friends.roblox.com/v1/users/${id}/followings/count`, { cacheMs: cache }).then(r => r.count).catch(() => null),
  ]);
  return { friends, followers, following };
}

export type ThumbKind = 'headshot' | 'bust' | 'full';
const THUMB_PATH: Record<ThumbKind, string> = { headshot: 'avatar-headshot', bust: 'avatar-bust', full: 'avatar' };

export async function avatarUrl(id: number, kind: ThumbKind = 'full', size = '420x420'): Promise<string | null> {
  const r = await getJson<{ data: { imageUrl?: string; state: string }[] }>(
    `https://thumbnails.roblox.com/v1/users/${THUMB_PATH[kind]}?userIds=${id}&size=${size}&format=Png&isCircular=false`, { cacheMs: cache });
  const t = r.data?.[0];
  return t?.state === 'Completed' && t.imageUrl ? t.imageUrl : null;
}

export async function assetThumb(assetId: number, size = '420x420'): Promise<string | null> {
  const r = await getJson<{ data: { imageUrl?: string; state: string }[] }>(`https://thumbnails.roblox.com/v1/assets?assetIds=${assetId}&size=${size}&format=Png`, { cacheMs: cache });
  const t = r.data?.[0];
  return t?.state === 'Completed' && t.imageUrl ? t.imageUrl : null;
}

export async function friends(id: number): Promise<{ id: number; name: string; displayName: string }[]> {
  const r = await getJson<{ data: { id: number }[] }>(`https://friends.roblox.com/v1/users/${id}/friends`, { cacheMs: cache });
  return usersByIds((r.data ?? []).map(f => f.id));
}

export async function usernameHistory(id: number): Promise<string[]> {
  const r = await getJson<{ data: { name: string }[] }>(`https://users.roblox.com/v1/users/${id}/username-history?limit=50&sortOrder=Desc`, { cacheMs: cache });
  return (r.data ?? []).map(x => x.name);
}

export interface RbxGroupRole { group: { id: number; name: string; memberCount?: number; hasVerifiedBadge?: boolean }; role: { name: string; rank: number } }
export async function userGroups(id: number): Promise<RbxGroupRole[]> {
  const r = await getJson<{ data: RbxGroupRole[] }>(`https://groups.roblox.com/v1/users/${id}/groups/roles`, { cacheMs: cache });
  return r.data ?? [];
}

export interface RbxGroup {
  id: number; name: string; description: string; memberCount: number; hasVerifiedBadge?: boolean; publicEntryAllowed?: boolean;
  owner?: { userId: number; username: string; displayName?: string } | null; shout?: { body: string; poster?: { username: string } } | null;
}
export async function groupById(id: number): Promise<RbxGroup> {
  try { return await getJson<RbxGroup>(`https://groups.roblox.com/v1/groups/${id}`, { cacheMs: cache }); }
  catch (e) { if (e instanceof HttpError && e.status >= 400 && e.status < 500) throw new RobloxNotFound(`There's no Roblox group with ID **${id}**.`); throw e; }
}
export async function resolveGroup(input: string): Promise<RbxGroup> {
  const s = input.trim();
  if (/^\d{1,12}$/.test(s)) return groupById(Number(s));
  const r = await getJson<{ data: { id: number }[] }>(`https://groups.roblox.com/v1/groups/search?keyword=${encodeURIComponent(s)}&limit=10`, { cacheMs: cache });
  const hit = r.data?.[0];
  if (!hit) throw new RobloxNotFound(`I couldn't find a Roblox group matching **${s}**.`);
  return groupById(hit.id);
}
export async function groupIcon(id: number): Promise<string | null> {
  const r = await getJson<{ data: { imageUrl?: string; state: string }[] }>(`https://thumbnails.roblox.com/v1/groups/icons?groupIds=${id}&size=150x150&format=Png`, { cacheMs: cache });
  return r.data?.[0]?.state === 'Completed' ? r.data[0]!.imageUrl ?? null : null;
}

export interface RbxGame {
  id: number; rootPlaceId: number; name: string; description: string; creator: { id: number; name: string; type: string; hasVerifiedBadge?: boolean };
  playing: number; visits: number; favoritedCount?: number; maxPlayers?: number; created?: string; updated?: string; genre?: string;
}
export async function gameByUniverse(universeId: number): Promise<RbxGame> {
  const r = await getJson<{ data: RbxGame[] }>(`https://games.roblox.com/v1/games?universeIds=${universeId}`, { cacheMs: 60_000 });
  const g = r.data?.[0];
  if (!g) throw new RobloxNotFound('I couldn\'t find that game.');
  return g;
}
export async function universeOfPlace(placeId: number): Promise<number> {
  try { return (await getJson<{ universeId: number }>(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`, { cacheMs: cache })).universeId; }
  catch { throw new RobloxNotFound(`There's no game with place ID **${placeId}**.`); }
}
export async function searchGame(query: string): Promise<{ universeId: number; name: string }> {
  const sid = crypto.randomUUID();
  const r = await getJson<{ searchResults?: { contentGroupType: string; contents?: { universeId: number; name: string }[] }[] }>(
    `https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(query)}&sessionId=${sid}&pageType=all`, { cacheMs: 60_000 });
  const hit = r.searchResults?.find(x => x.contentGroupType === 'Game')?.contents?.[0];
  if (!hit) throw new RobloxNotFound(`I couldn't find a Roblox game matching **${query}**.`);
  return hit;
}
export async function resolveGame(input: string): Promise<RbxGame> {
  const s = input.trim();
  if (/^\d{5,}$/.test(s)) {
    // Could be a place ID or a universe ID: try place first (what people copy from the URL).
    try { return await gameByUniverse(await universeOfPlace(Number(s))); } catch { return gameByUniverse(Number(s)); }
  }
  return gameByUniverse((await searchGame(s)).universeId);
}
export async function gameIcon(universeId: number): Promise<string | null> {
  const r = await getJson<{ data: { imageUrl?: string; state: string }[] }>(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&size=256x256&format=Png`, { cacheMs: cache });
  return r.data?.[0]?.state === 'Completed' ? r.data[0]!.imageUrl ?? null : null;
}

export interface UserGame { id: number; name: string; description?: string | null; created?: string; updated?: string; placeVisits?: number; rootPlace?: { id: number } }
export async function userGames(id: number): Promise<UserGame[]> {
  const r = await getJson<{ data: UserGame[] }>(`https://games.roblox.com/v2/users/${id}/games?limit=25&sortOrder=Desc`, { cacheMs: cache });
  return r.data ?? [];
}

export async function wearing(id: number): Promise<number[]> {
  return (await getJson<{ assetIds: number[] }>(`https://avatar.roblox.com/v1/users/${id}/currently-wearing`, { cacheMs: cache })).assetIds ?? [];
}
export async function outfits(id: number): Promise<{ id: number; name: string }[]> {
  return (await getJson<{ data: { id: number; name: string }[] }>(`https://avatar.roblox.com/v1/users/${id}/outfits?itemsPerPage=25`, { cacheMs: cache })).data ?? [];
}

export interface RbxAsset { AssetId: number; Name: string; Description: string; Creator?: { Name: string; Id: number }; PriceInRobux: number | null; Created?: string; Updated?: string; Sales?: number; ProductType?: string | null; AssetTypeId?: number; IsLimited?: boolean; IsLimitedUnique?: boolean }
export async function assetDetails(id: number): Promise<RbxAsset> {
  try { return await getJson<RbxAsset>(`https://economy.roblox.com/v2/assets/${id}/details`, { cacheMs: cache }); }
  catch (e) { if (e instanceof HttpError && e.status >= 400 && e.status < 500) throw new RobloxNotFound(`There's no Roblox item with ID **${id}**.`); throw e; }
}

/** The texture behind a classic shirt/pants (its "template") — the asset may be the PNG itself or an XML pointing at it. */
export async function templateImage(assetId: number): Promise<Buffer> {
  const first = await getBuffer(`https://assetdelivery.roblox.com/v1/asset?id=${assetId}`, { maxBytes: 8 * 1024 * 1024 });
  if (first.subarray(1, 4).toString('ascii') === 'PNG') return first;
  const xml = first.toString('utf8');
  const tex = /<url>[^<]*id=(\d+)<\/url>/i.exec(xml)?.[1];
  if (!tex) throw new RobloxNotFound('That item doesn\'t have a shirt/pants template.');
  const img = await getBuffer(`https://assetdelivery.roblox.com/v1/asset?id=${tex}`, { maxBytes: 8 * 1024 * 1024 });
  if (img.subarray(1, 4).toString('ascii') !== 'PNG') throw new RobloxNotFound('I couldn\'t load that item\'s template image.');
  return img;
}

// ─── Rolimons item values (public JSON) ──────────────────────────────────────

export interface RolimonsItem { id: number; name: string; acronym: string; rap: number; value: number; defaultValue: number; demand: number; trend: number; projected: boolean; hyped: boolean; rare: boolean }
const DEMAND = ['Terrible', 'Low', 'Normal', 'High', 'Amazing'];
const TREND = ['Lowering', 'Unstable', 'Stable', 'Raising', 'Fluctuating'];
export const demandName = (d: number) => DEMAND[d] ?? '—';
export const trendName = (t: number) => TREND[t] ?? '—';

export function parseRolimons(json: { items?: Record<string, (string | number)[]> }): RolimonsItem[] {
  return Object.entries(json.items ?? {}).map(([id, a]) => ({
    id: Number(id), name: String(a[0]), acronym: String(a[1] ?? ''), rap: Number(a[2]), value: Number(a[3]), defaultValue: Number(a[4]),
    demand: Number(a[5]), trend: Number(a[6]), projected: Number(a[7]) === 1, hyped: Number(a[8]) === 1, rare: Number(a[9]) === 1,
  }));
}
export async function rolimonsItems(): Promise<RolimonsItem[]> {
  return parseRolimons(await getJson('https://api.rolimons.com/items/v1/itemdetails', { cacheMs: 10 * 60_000 }));
}
export function findRolimons(items: RolimonsItem[], q: string): RolimonsItem | null {
  const s = q.trim().toLowerCase();
  if (/^\d+$/.test(s)) return items.find(i => i.id === Number(s)) ?? null;
  return items.find(i => i.name.toLowerCase() === s) ?? items.find(i => i.acronym.toLowerCase() === s) ?? items.find(i => i.name.toLowerCase().includes(s)) ?? null;
}

// ─── Pure calculators ────────────────────────────────────────────────────────

/** Robux you receive when something sells at `price` (Roblox keeps 30%). */
export const afterTax = (price: number) => Math.floor(price * (1 - ROBLOX_TAX));
/** The price to list at so that you receive `want` after tax. */
export const priceToReceive = (want: number) => Math.ceil(want / (1 - ROBLOX_TAX));
export const robuxToUsd = (robux: number, rate = devexRate()) => robux * rate;

export const profileUrl = (id: number) => `https://www.roblox.com/users/${id}/profile`;
export const groupUrl = (id: number) => `https://www.roblox.com/groups/${id}`;
export const gameUrl = (placeId: number) => `https://www.roblox.com/games/${placeId}`;
export const itemUrl = (id: number) => `https://www.roblox.com/catalog/${id}`;
void USER_AGENT;
