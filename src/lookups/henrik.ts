import { getJson, HttpError } from '../framework/http.js';
import { LookupError } from './handler.js';

/**
 * Valorant player data (accounts, rank, matches, RR history, featured store) from HenrikDev's API — the same source most Valorant
 * bots use. It needs a free key (HENRIK_API_KEY, from the HenrikDev Discord). Static game data (agents, maps…) stays on valorant-api.com.
 * Responses have changed shape across API versions, so the parsers accept both the v2/v3 and v4 layouts.
 */

const API = 'https://api.henrikdev.xyz/valorant';
export type Platform = 'pc' | 'console';
export const REGIONS = ['na', 'eu', 'ap', 'kr', 'latam', 'br'] as const;

async function hd<T>(path: string, cacheMs = 60_000): Promise<T> {
  const key = Bun.env.HENRIK_API_KEY;
  if (!key) throw new LookupError('Valorant player lookups need a HenrikDev API key (HENRIK_API_KEY), which the bot owner hasn\'t set.');
  try {
    const r = await getJson<{ status?: number; data?: T; errors?: { message?: string }[] }>(`${API}${path}`, { headers: { Authorization: key }, cacheMs, timeoutMs: 20_000 });
    if (r.data == null) throw new LookupError(r.errors?.[0]?.message ?? 'Riot didn\'t return that.');
    return r.data;
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) throw new LookupError('I couldn\'t find that Riot account (check the name and tag).');
    if (e instanceof HttpError && e.status === 429) throw new LookupError('The Valorant API is rate-limiting me — try again in a minute.');
    throw e;
  }
}

export function cleanRiot(name: string, tag: string): { name: string; tag: string } {
  const n = name.trim(), t = tag.trim().replace(/^#/, '');
  if (!n || n.length > 16 || !t || t.length > 5) throw new LookupError('Give a Riot name (up to 16 characters) and tag (up to 5, without #).');
  return { name: n, tag: t };
}
const enc = (s: string) => encodeURIComponent(s);

export interface VAccount { puuid: string; name: string; tag: string; region: string; level: number; card?: string; cardWide?: string; title?: string; updated?: string }

export async function vAccount(name: string, tag: string): Promise<VAccount> {
  const a = await hd<{ puuid: string; name: string; tag: string; region: string; account_level: number; card?: { small?: string; large?: string; wide?: string } | string; title?: string; last_update?: string; updated_at?: string }>(`/v1/account/${enc(name)}/${enc(tag)}`, 10 * 60_000);
  const card = typeof a.card === 'object' ? a.card : undefined;
  return { puuid: a.puuid, name: a.name, tag: a.tag, region: a.region, level: a.account_level, card: card?.small, cardWide: card?.wide, title: a.title, updated: a.last_update ?? a.updated_at };
}

export interface VRank { tier: string; rr: number; lastChange?: number; elo?: number; peak?: string; icon?: string }

type MmrRaw = {
  current?: { tier?: { name?: string }; rr?: number; last_change?: number; elo?: number }; peak?: { tier?: { name?: string } };
  current_data?: { currenttierpatched?: string; ranking_in_tier?: number; mmr_change_to_last_game?: number; elo?: number; images?: { small?: string } }; highest_rank?: { patched_tier?: string };
};

export function parseMmr(r: MmrRaw): VRank | null {
  if (r.current?.tier?.name) return { tier: r.current.tier.name, rr: r.current.rr ?? 0, lastChange: r.current.last_change, elo: r.current.elo, peak: r.peak?.tier?.name };
  if (r.current_data?.currenttierpatched) return { tier: r.current_data.currenttierpatched, rr: r.current_data.ranking_in_tier ?? 0, lastChange: r.current_data.mmr_change_to_last_game, elo: r.current_data.elo, peak: r.highest_rank?.patched_tier, icon: r.current_data.images?.small };
  return null;
}

export async function vRank(region: string, platform: Platform, name: string, tag: string): Promise<VRank | null> {
  return parseMmr(await hd<MmrRaw>(`/v3/mmr/${region}/${platform}/${enc(name)}/${enc(tag)}`).catch(() => ({})));
}

export interface VMatch { id: string; map: string; mode: string; started: number; agent?: string; kills?: number; deaths?: number; assists?: number; score?: number; won?: boolean; rounds?: string }

type MatchV4 = { metadata: { match_id: string; map?: { name?: string }; queue?: { name?: string; mode_type?: string }; started_at?: string }; players: { puuid: string; name: string; tag: string; team_id: string; agent?: { name?: string }; stats?: { kills: number; deaths: number; assists: number; score: number }; tier?: { name?: string } }[]; teams: { team_id: string; won?: boolean; rounds?: { won: number; lost: number } }[] };
type MatchV3 = { metadata: { matchid: string; map?: string; mode?: string; game_start?: number; rounds_played?: number }; players: { all_players: { puuid: string; name: string; tag: string; team: string; character?: string; currenttier_patched?: string; stats?: { kills: number; deaths: number; assists: number; score: number } }[] }; teams?: Record<string, { has_won?: boolean; rounds_won?: number; rounds_lost?: number }> };

export function parseMatchFor(m: MatchV4 | MatchV3, puuid: string): VMatch {
  if (Array.isArray((m as MatchV4).players)) {
    const x = m as MatchV4, p = x.players.find(q => q.puuid === puuid), t = x.teams.find(q => q.team_id === p?.team_id);
    return { id: x.metadata.match_id, map: x.metadata.map?.name ?? '?', mode: x.metadata.queue?.name ?? x.metadata.queue?.mode_type ?? '?', started: Date.parse(x.metadata.started_at ?? '') || 0,
      agent: p?.agent?.name, kills: p?.stats?.kills, deaths: p?.stats?.deaths, assists: p?.stats?.assists, score: p?.stats?.score, won: t?.won, rounds: t?.rounds ? `${t.rounds.won}–${t.rounds.lost}` : undefined };
  }
  const x = m as MatchV3, p = x.players.all_players.find(q => q.puuid === puuid), t = p ? x.teams?.[p.team.toLowerCase()] : undefined;
  return { id: x.metadata.matchid, map: x.metadata.map ?? '?', mode: x.metadata.mode ?? '?', started: (x.metadata.game_start ?? 0) * 1000,
    agent: p?.character, kills: p?.stats?.kills, deaths: p?.stats?.deaths, assists: p?.stats?.assists, score: p?.stats?.score, won: t?.has_won, rounds: t ? `${t.rounds_won}–${t.rounds_lost}` : undefined };
}

export async function vMatches(region: string, platform: Platform, name: string, tag: string, puuid: string, size = 5): Promise<VMatch[]> {
  const list = await hd<(MatchV4 | MatchV3)[]>(`/v4/matches/${region}/${platform}/${enc(name)}/${enc(tag)}?size=${size}`).catch(() => [] as (MatchV4 | MatchV3)[]);
  return list.map(m => parseMatchFor(m, puuid));
}

export interface VHistoryRow { tier: string; rr: number; change: number; map?: string; date: number }

export function parseHistory(r: unknown): VHistoryRow[] {
  const rows = Array.isArray(r) ? r : (r as { history?: unknown[] })?.history ?? [];
  return (rows as Record<string, unknown>[]).map(h => {
    const tier = (h.tier as { name?: string } | undefined)?.name ?? (h.currenttierpatched as string | undefined) ?? '?';
    const rr = (h.rr as number | undefined) ?? (h.ranking_in_tier as number | undefined) ?? 0;
    const change = (h.last_change as number | undefined) ?? (h.mmr_change_to_last_game as number | undefined) ?? 0;
    const map = (h.map as { name?: string } | undefined)?.name;
    const date = Date.parse(String(h.date ?? '')) || ((h.date_raw as number | undefined) ?? 0) * 1000;
    return { tier, rr, change, map, date };
  });
}

export async function vHistory(region: string, platform: Platform, name: string, tag: string): Promise<VHistoryRow[]> {
  return parseHistory(await hd<unknown>(`/v2/mmr-history/${region}/${platform}/${enc(name)}/${enc(tag)}`));
}

export interface Scoreboard { map: string; mode: string; started: number; length?: number; teams: { name: string; won?: boolean; rounds?: number; players: { name: string; tag: string; agent?: string; kills: number; deaths: number; assists: number; score: number; tier?: string }[] }[] }

export function parseScoreboard(m: MatchV4 | MatchV3): Scoreboard {
  if (Array.isArray((m as MatchV4).players)) {
    const x = m as MatchV4;
    return {
      map: x.metadata.map?.name ?? '?', mode: x.metadata.queue?.name ?? '?', started: Date.parse(x.metadata.started_at ?? '') || 0,
      teams: x.teams.map(t => ({ name: t.team_id, won: t.won, rounds: t.rounds?.won, players: x.players.filter(p => p.team_id === t.team_id).map(p => ({ name: p.name, tag: p.tag, agent: p.agent?.name, kills: p.stats?.kills ?? 0, deaths: p.stats?.deaths ?? 0, assists: p.stats?.assists ?? 0, score: p.stats?.score ?? 0, tier: p.tier?.name })).sort((a, b) => b.score - a.score) })),
    };
  }
  const x = m as MatchV3;
  const teams = ['Red', 'Blue'].map(name => {
    const t = x.teams?.[name.toLowerCase()];
    return { name, won: t?.has_won, rounds: t?.rounds_won, players: x.players.all_players.filter(p => p.team === name).map(p => ({ name: p.name, tag: p.tag, agent: p.character, kills: p.stats?.kills ?? 0, deaths: p.stats?.deaths ?? 0, assists: p.stats?.assists ?? 0, score: p.stats?.score ?? 0, tier: p.currenttier_patched })).sort((a, b) => b.score - a.score) };
  }).filter(t => t.players.length);
  return { map: x.metadata.map ?? '?', mode: x.metadata.mode ?? '?', started: (x.metadata.game_start ?? 0) * 1000, teams };
}

export async function vMatch(id: string, region?: string): Promise<Scoreboard> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim())) throw new LookupError('A match ID looks like `a1b2c3d4-…` (a UUID).');
  const m = region ? await hd<MatchV4 | MatchV3>(`/v4/match/${region}/${id.trim()}`, 60 * 60_000) : await hd<MatchV4 | MatchV3>(`/v2/match/${id.trim()}`, 60 * 60_000);
  return parseScoreboard(m);
}

export interface FeaturedBundle { uuid: string; price: number; secondsLeft: number; items: { name?: string; type?: string; price?: number }[] }

export async function vStore(): Promise<FeaturedBundle[]> {
  const r = await hd<{ bundle_uuid: string; bundle_price: number; seconds_remaining: number; items?: { name?: string; type?: string; base_price?: number; discounted_price?: number }[] }[]>('/v2/store-featured', 10 * 60_000);
  return r.map(b => ({ uuid: b.bundle_uuid, price: b.bundle_price, secondsLeft: b.seconds_remaining, items: (b.items ?? []).map(i => ({ name: i.name, type: i.type, price: i.discounted_price ?? i.base_price })) }));
}

/** Bundle names/art come from valorant-api.com (keyless). */
export async function bundleInfo(uuid: string): Promise<{ name: string; image?: string } | null> {
  return getJson<{ data?: { displayName: string; displayIcon?: string } }>(`https://valorant-api.com/v1/bundles/${uuid}`, { cacheMs: 6 * 3_600_000 }).then(r => (r.data ? { name: r.data.displayName, image: r.data.displayIcon } : null)).catch(() => null);
}
