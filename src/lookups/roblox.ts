import { getJson, getBuffer, getText, postJson, HttpError, USER_AGENT } from '../framework/http.js';
import { LookupError } from './handler.js';

/** Roblox public web APIs (no key). Follower/following lists need a login; see ROBLOX_COOKIE below. */

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

// ─── Follow lists, badges, inventory (Heist extras) ─────────────────────────

/**
 * Roblox now serves follower/following lists only to logged-in accounts. ROBLOX_COOKIE (the .ROBLOSECURITY cookie of a spare account
 * you own — never your main one) unlocks them; without it these commands explain why they can't list names.
 */
const authHeaders = (): Record<string, string> => (Bun.env.ROBLOX_COOKIE ? { Cookie: `.ROBLOSECURITY=${Bun.env.ROBLOX_COOKIE}` } : {});

export async function followList(id: number, which: 'followers' | 'followings'): Promise<{ id: number; name: string; displayName: string }[]> {
  let r: { data: { id: number }[] };
  try {
    r = await getJson(`https://friends.roblox.com/v1/users/${id}/${which}?limit=50&sortOrder=Desc`, { cacheMs: cache, headers: authHeaders() });
  } catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
      throw new LookupError(`Roblox only shows ${which === 'followers' ? 'follower' : 'following'} lists to logged-in accounts, and the bot owner hasn't set one up (ROBLOX_COOKIE).`);
    }
    throw e;
  }
  return usersByIds((r.data ?? []).map(x => x.id));
}

export interface RbxBadge { id: number; name: string; description?: string; awarder?: { id: number; type: string }; awardedDate?: string; icon?: string }

export async function recentBadges(id: number, limit = 25): Promise<RbxBadge[]> {
  let r: { data: RbxBadge[] };
  try { r = await getJson(`https://badges.roblox.com/v1/users/${id}/badges?limit=${limit}&sortOrder=Desc`, { cacheMs: cache }); }
  catch (e) { if (e instanceof HttpError && e.status === 403) throw new LookupError('That user\'s badges are private.'); throw e; }
  const list = (r.data ?? []).slice(0, limit);
  if (!list.length) return [];
  const ids = list.map(b => b.id).join(',');
  const [dates, icons] = await Promise.all([
    getJson<{ data: { badgeId: number; awardedDate: string }[] }>(`https://badges.roblox.com/v1/users/${id}/badges/awarded-dates?badgeIds=${ids}`, { cacheMs: cache }).catch(() => ({ data: [] })),
    getJson<{ data: { targetId: number; imageUrl?: string; state: string }[] }>(`https://thumbnails.roblox.com/v1/badges/icons?badgeIds=${ids}&size=150x150&format=Png`, { cacheMs: cache }).catch(() => ({ data: [] })),
  ]);
  return list.map(b => ({
    ...b, awardedDate: dates.data.find(d => d.badgeId === b.id)?.awardedDate,
    icon: icons.data.find(t => t.targetId === b.id && t.state === 'Completed')?.imageUrl,
  }));
}

/** Games a user recently played, inferred from where their newest badges came from (most recent first, one row per game). */
export async function gameHistory(id: number): Promise<{ universeId: number; name: string; rootPlaceId: number; lastBadge: string; badgeName: string }[]> {
  const badges = (await recentBadges(id, 30)).slice(0, 20);
  const details = await Promise.all(badges.map(b => getJson<{ awardingUniverse?: { id: number; name: string; rootPlaceId: number } }>(`https://badges.roblox.com/v1/badges/${b.id}`, { cacheMs: cache }).catch(() => null)));
  const seen = new Set<number>();
  const out: { universeId: number; name: string; rootPlaceId: number; lastBadge: string; badgeName: string }[] = [];
  details.forEach((d, n) => {
    const u = d?.awardingUniverse;
    if (!u || seen.has(u.id)) return;
    seen.add(u.id);
    out.push({ universeId: u.id, name: u.name, rootPlaceId: u.rootPlaceId, lastBadge: badges[n]!.awardedDate ?? '', badgeName: badges[n]!.name });
  });
  return out;
}

/**
 * Roblox hides the friends list of some accounts (for example under UK/Australian child-safety rules) while the count stays public.
 * A non-zero count with an empty list means the list is hidden.
 */
export async function friendsHidden(id: number): Promise<{ count: number | null; listed: number; hidden: boolean }> {
  const [c, list] = await Promise.all([counts(id), getJson<{ data: unknown[] }>(`https://friends.roblox.com/v1/users/${id}/friends`, { cacheMs: cache }).then(r => r.data?.length ?? 0).catch(() => 0)]);
  return { count: c.friends, listed: list, hidden: (c.friends ?? 0) > 0 && list === 0 };
}

/** Names like "A Initial Necklace", "Letter B Chain", "Initial C" — the popular single-letter necklace UGC items. */
export const isInitialNecklace = (name: string) => /\binitials?\b|\bletter\b|^\s*[A-Z]\s*(necklace|chain)\b|\b[A-Z]\s*(necklace|chain)\s*$/i.test(name);

export async function necklaces(id: number): Promise<{ assetId: number; name: string }[]> {
  let r: { data: { assetId: number; name: string }[] };
  try { r = await getJson(`https://inventory.roblox.com/v2/users/${id}/inventory/43?limit=100&sortOrder=Desc`, { cacheMs: cache }); }
  catch (e) { if (e instanceof HttpError && (e.status === 403 || e.status === 401)) throw new LookupError('That user\'s inventory is private.'); throw e; }
  return (r.data ?? []).filter(x => isInitialNecklace(x.name)).map(x => ({ assetId: x.assetId, name: x.name }));
}

// ─── 3D renders ──────────────────────────────────────────────────────────────

export interface Manifest3d { obj: string; mtl: string; textures: string[] }

/** Roblox's CDN host for a content hash (the classic t0–t7 sharding); tr.rbxcdn.com is tried first. */
export function hashUrl(hash: string): string[] {
  let i = 31;
  for (const ch of hash) i ^= ch.charCodeAt(0);
  return [`https://tr.rbxcdn.com/${hash}`, `https://t${i % 8}.rbxcdn.com/${hash}`];
}

async function fetchHash(hash: string): Promise<Buffer> {
  let last: unknown;
  for (const u of hashUrl(hash)) { try { return await getBuffer(u, { maxBytes: 15 * 1024 * 1024, timeoutMs: 20_000 }); } catch (e) { last = e; } }
  throw last;
}

async function manifestFrom(url: string): Promise<Manifest3d> {
  const r = await getJson<{ imageUrl?: string; state?: string }>(url, { cacheMs: 60_000 });
  if (r.state !== 'Completed' || !r.imageUrl) throw new LookupError('Roblox is still rendering that 3D model — try again in a few seconds.');
  const m = await getJson<Partial<Manifest3d>>(r.imageUrl, { cacheMs: 60_000 });
  if (!m.obj || !m.mtl) throw new LookupError('Roblox didn\'t return a 3D model for that.');
  return { obj: m.obj, mtl: m.mtl, textures: m.textures ?? [] };
}

export const avatar3d = (userId: number) => manifestFrom(`https://thumbnails.roblox.com/v1/users/avatar-3d?userId=${userId}`);
export const asset3d = (assetId: number) => manifestFrom(`https://thumbnails.roblox.com/v1/assets-thumbnail-3d?assetId=${assetId}`);

/** Downloads a model and renames its files so any 3D viewer can open it: model.obj → model.mtl → <texture>.png. */
export async function modelFiles(m: Manifest3d): Promise<{ name: string; data: Buffer }[]> {
  const [obj, mtl, ...tex] = await Promise.all([fetchHash(m.obj), fetchHash(m.mtl), ...m.textures.slice(0, 8).map(fetchHash)]);
  let objText = obj!.toString('utf8').replace(/^mtllib\s+\S+/m, 'mtllib model.mtl');
  if (!/^mtllib/m.test(objText)) objText = `mtllib model.mtl\n${objText}`;
  let mtlText = mtl!.toString('utf8');
  for (const h of m.textures) mtlText = mtlText.split(h).join(`${h}.png`);
  return [{ name: 'model.obj', data: Buffer.from(objText) }, { name: 'model.mtl', data: Buffer.from(mtlText) }, ...tex.map((t, n) => ({ name: `${m.textures[n]}.png`, data: t }))];
}

// ─── Rolimons players ────────────────────────────────────────────────────────

export interface RolimonsPlayer { name: string; rap: number | null; value: number | null; rank: number | null; premium: boolean; privacy: boolean; terminated: boolean; lastOnline?: number; lastLocation?: string; updated?: number }

export function parsePlayer(r: { success?: boolean; playername?: string; rap?: number | null; value?: number | null; rank?: number | null; premium?: boolean; privacy_enabled?: boolean; terminated?: boolean; last_online?: number | null; last_location?: string | null; stats_updated?: number | null }): RolimonsPlayer | null {
  if (!r.success) return null;
  return { name: r.playername ?? '', rap: r.rap ?? null, value: r.value ?? null, rank: r.rank ?? null, premium: !!r.premium, privacy: !!r.privacy_enabled, terminated: !!r.terminated,
    lastOnline: r.last_online ?? undefined, lastLocation: r.last_location ?? undefined, updated: r.stats_updated ?? undefined };
}

export async function rolimonsPlayer(id: number): Promise<RolimonsPlayer> {
  const p = parsePlayer(await getJson(`https://api.rolimons.com/players/v1/playerinfo/${id}`, { cacheMs: 5 * 60_000 }));
  if (!p) throw new LookupError('Rolimons doesn\'t have that player yet (they need to be scanned first on rolimons.com).');
  return p;
}

export interface ValuePoint { t: number; rap: number; value: number }

/** Rolimons player pages embed their chart as `var chart_data = {...}`. */
export function parseChart(html: string): ValuePoint[] {
  const m = /var\s+chart_data\s*=\s*(\{[\s\S]*?\});/.exec(html);
  if (!m) return [];
  let d: { timestamp?: number[]; rap?: number[]; value?: number[] };
  try { d = JSON.parse(m[1]!); } catch { return []; }
  const ts = d.timestamp ?? [];
  return ts.map((t, n) => ({ t: t < 1e12 ? t * 1000 : t, rap: d.rap?.[n] ?? 0, value: d.value?.[n] ?? 0 })).filter(p => Number.isFinite(p.t));
}

export async function rolimonsChart(id: number): Promise<ValuePoint[]> {
  return parseChart(await getText(`https://www.rolimons.com/player/${id}`, { cacheMs: 10 * 60_000 }));
}

// ─── Pure calculators ────────────────────────────────────────────────────────

/** "100k" / "1.5m" / "10b" / "1,000" → a whole number of Robux (null if it isn't one). */
export function parseRobux(input: string): number | null {
  const m = /^\s*R?\$?\s*([\d,]*\.?\d+)\s*([kmb])?\s*$/i.exec(input);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, '')) * ({ k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? '').toLowerCase() as 'k' | 'm' | 'b'] ?? 1);
  return Number.isFinite(n) && n >= 1 && n <= 1e12 ? Math.round(n) : null;
}

/** An asset ID or a catalog/library/bundle URL → the ID. */
export function parseAssetId(input: string): number | null {
  const s = input.trim();
  const m = /(?:catalog|library|bundles|marketplace\/asset|games)\/(\d{1,15})/i.exec(s) ?? /[?&]id=(\d{1,15})/.exec(s) ?? /^(\d{1,15})$/.exec(s);
  return m ? Number(m[1]) : null;
}

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
