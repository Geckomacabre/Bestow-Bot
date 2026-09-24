import he from 'he';
import { getJson, HttpError } from '../framework/http.js';
import { LookupError } from './handler.js';

/** Game/dev-platform lookups. Everything here uses public, keyless endpoints (optional keys are noted). */

const MIN5 = 5 * 60_000;
const HOUR = 3_600_000;

export const stripHtml = (s: string) => he.decode(s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim();

// ─── Minecraft ───────────────────────────────────────────────────────────────

export interface McServer {
  online: boolean; hostname?: string; ip?: string; port?: number; version?: string; protocolName?: string; software?: string; edition: 'java' | 'bedrock';
  motd: string; players?: { online: number; max: number; list?: string[] }; iconDataUri?: string; eulaBlocked?: boolean;
}
type McRaw = {
  online: boolean; hostname?: string; ip?: string; port?: number; version?: string; protocol?: { name?: string }; software?: string;
  motd?: { clean?: string[] }; players?: { online: number; max: number; list?: { name: string }[] }; icon?: string; eula_blocked?: boolean; gamemode?: string;
};

export function parseMcServer(raw: McRaw, edition: 'java' | 'bedrock'): McServer {
  return {
    online: !!raw.online, hostname: raw.hostname, ip: raw.ip, port: raw.port, version: raw.version, protocolName: raw.protocol?.name, software: raw.software, edition,
    motd: (raw.motd?.clean ?? []).map(l => l.trim()).filter(Boolean).join('\n'),
    players: raw.players ? { online: raw.players.online, max: raw.players.max, list: raw.players.list?.map(p => p.name) } : undefined,
    iconDataUri: raw.icon, eulaBlocked: raw.eula_blocked,
  };
}

/** Accepts host, host:port, or a hostname with a scheme pasted in. */
export function cleanAddress(input: string): string {
  const a = input.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
  const m = /^((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)(?::(\d{1,5}))?$/i.exec(a);
  if (!m || a.length > 100 || (m[2] && Number(m[2]) > 65535)) throw new LookupError('That doesn\'t look like a server address (try `play.example.com` or `host:25565`).');
  return a;
}

export async function mcServer(address: string, edition: 'java' | 'bedrock' = 'java'): Promise<McServer> {
  const a = cleanAddress(address);
  const raw = await getJson<McRaw>(`https://api.mcsrvstat.us/${edition === 'bedrock' ? 'bedrock/3' : '3'}/${a}`, { cacheMs: MIN5 });
  return parseMcServer(raw, edition);
}

export interface McPlayer { id: string; name: string; skinUrl?: string; avatar?: string; nameHistory: { name: string; changedToAt?: string }[] }
export async function mcPlayer(name: string): Promise<McPlayer> {
  const n = name.trim();
  if (!/^[A-Za-z0-9_]{1,16}$/.test(n) && !/^[0-9a-f-]{32,36}$/i.test(n)) throw new LookupError('Minecraft usernames are 3–16 letters, numbers or underscores.');
  try {
    const r = await getJson<{ success: boolean; data?: { player?: { id: string; username: string; skin_texture?: string; avatar?: string; name_history?: { name: string; changedToPlayerAt?: string }[] } } }>(
      `https://playerdb.co/api/player/minecraft/${encodeURIComponent(n)}`, { cacheMs: MIN5 });
    const p = r.data?.player;
    if (!r.success || !p) throw new LookupError(`There's no Minecraft player called **${n}**.`);
    return { id: p.id, name: p.username, skinUrl: p.skin_texture, avatar: p.avatar, nameHistory: (p.name_history ?? []).map(h => ({ name: h.name, changedToAt: h.changedToPlayerAt })) };
  } catch (e) {
    if (e instanceof HttpError && e.status >= 400 && e.status < 500) throw new LookupError(`There's no Minecraft player called **${n}**.`);
    throw e;
  }
}
export const mcBody = (uuid: string) => `https://crafthead.net/body/${uuid}/256`;
export const mcHead = (uuid: string) => `https://crafthead.net/avatar/${uuid}/128`;
export const mcSkin = (uuid: string) => `https://crafthead.net/skin/${uuid}`;

// ─── GitHub ──────────────────────────────────────────────────────────────────

const ghHeaders = (): Record<string, string> => ({ Accept: 'application/vnd.github+json', ...(Bun.env.GITHUB_TOKEN ? { Authorization: `Bearer ${Bun.env.GITHUB_TOKEN}` } : {}) });

export interface GhRepo {
  full_name: string; html_url: string; description: string | null; stargazers_count: number; forks_count: number; watchers_count: number; open_issues_count: number;
  language: string | null; license: { spdx_id: string | null; name: string } | null; topics?: string[]; created_at: string; updated_at: string; pushed_at: string;
  size: number; default_branch: string; archived: boolean; fork: boolean; homepage: string | null; owner: { login: string; avatar_url: string };
}
export function parseRepoRef(input: string): { owner: string; repo: string } {
  const raw = input.trim();
  // A pasted link may carry a path (/tree/main …); a bare reference must be exactly owner/name.
  const isUrl = /^https?:\/\//i.test(raw);
  const m = (isUrl
    ? /^https?:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?(?:[/?#].*)?$/i
    : /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?$/).exec(raw);
  if (!m) throw new LookupError('Give the repo as `owner/name` (or paste its GitHub link).');
  return { owner: m[1]!, repo: m[2]! };
}
async function gh<T>(path: string, what: string): Promise<T> {
  try { return await getJson<T>(`https://api.github.com${path}`, { headers: ghHeaders(), cacheMs: MIN5 }); }
  catch (e) {
    if (e instanceof HttpError && e.status === 404) throw new LookupError(`I couldn't find ${what} on GitHub.`);
    if (e instanceof HttpError && (e.status === 403 || e.status === 429)) throw new LookupError('GitHub is rate-limiting me (the bot owner can set GITHUB_TOKEN to raise the limit).');
    throw e;
  }
}
export async function ghRepo(input: string): Promise<GhRepo> { const { owner, repo } = parseRepoRef(input); return gh<GhRepo>(`/repos/${owner}/${repo}`, `**${owner}/${repo}**`); }

export interface GhUser {
  login: string; html_url: string; avatar_url: string; name: string | null; bio: string | null; company: string | null; location: string | null; blog: string | null;
  twitter_username: string | null; public_repos: number; public_gists: number; followers: number; following: number; created_at: string; type: string;
}
export async function ghUser(name: string): Promise<GhUser> {
  const n = name.trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(n)) throw new LookupError('That isn\'t a valid GitHub username.');
  return gh<GhUser>(`/users/${n}`, `the user **${n}**`);
}

// ─── Steam ───────────────────────────────────────────────────────────────────

export interface SteamApp {
  id: number; name: string; short: string; header?: string; developers: string[]; publishers: string[]; free: boolean; price?: string; discount?: number; initialPrice?: string;
  release?: string; genres: string[]; metacritic?: number; platforms: string[]; website?: string; recommendations?: number; requiredAge?: number;
}
type SteamRaw = {
  success: boolean; data?: {
    name: string; steam_appid: number; short_description?: string; header_image?: string; developers?: string[]; publishers?: string[]; is_free?: boolean; website?: string; required_age?: number | string;
    price_overview?: { final_formatted: string; initial_formatted: string; discount_percent: number }; release_date?: { date: string; coming_soon: boolean }; genres?: { description: string }[];
    metacritic?: { score: number }; platforms?: { windows?: boolean; mac?: boolean; linux?: boolean }; recommendations?: { total: number };
  };
};
export function parseSteamApp(raw: SteamRaw): SteamApp | null {
  const d = raw?.success ? raw.data : undefined;
  if (!d) return null;
  return {
    id: d.steam_appid, name: d.name, short: stripHtml(d.short_description ?? ''), header: d.header_image, developers: d.developers ?? [], publishers: d.publishers ?? [], free: !!d.is_free,
    price: d.price_overview?.final_formatted, discount: d.price_overview?.discount_percent, initialPrice: d.price_overview?.initial_formatted, release: d.release_date?.date,
    genres: (d.genres ?? []).map(g => g.description), metacritic: d.metacritic?.score, platforms: Object.entries(d.platforms ?? {}).filter(([, v]) => v).map(([k]) => ({ windows: 'Windows', mac: 'macOS', linux: 'Linux' } as Record<string, string>)[k] ?? k),
    website: d.website, recommendations: d.recommendations?.total, requiredAge: Number(d.required_age) || undefined,
  };
}
export async function steamSearch(query: string): Promise<number> {
  const r = await getJson<{ items?: { id: number; type: string }[] }>(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=us`, { cacheMs: MIN5 });
  const hit = r.items?.find(i => i.type === 'app');
  if (!hit) throw new LookupError(`I couldn't find a Steam game matching **${query}**.`);
  return hit.id;
}
export async function steamApp(query: string): Promise<SteamApp & { players: number | null }> {
  const id = /^\d{1,9}$/.test(query.trim()) ? Number(query) : await steamSearch(query);
  const raw = await getJson<Record<string, SteamRaw>>(`https://store.steampowered.com/api/appdetails?appids=${id}&cc=us&l=english`, { cacheMs: MIN5 });
  // Steam sometimes answers under a different key than the one requested (asking for 620 returns key 323180).
  const app = parseSteamApp(raw[String(id)] ?? Object.values(raw)[0]!);
  if (!app) throw new LookupError(`I couldn't load details for Steam app **${id}**.`);
  const players = await getJson<{ response?: { player_count?: number } }>(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${id}`, { cacheMs: 60_000 }).then(r => r.response?.player_count ?? null).catch(() => null);
  return { ...app, players };
}

// ─── Valorant (valorant-api.com) ─────────────────────────────────────────────

export interface VAgent { uuid: string; displayName: string; description: string; role?: { displayName: string; displayIcon?: string }; displayIcon?: string; fullPortrait?: string; bustPortrait?: string; abilities: { slot: string; displayName: string; description: string; displayIcon?: string | null }[]; backgroundGradientColors?: string[] }
export interface VMap { uuid: string; displayName: string; tacticalDescription?: string | null; coordinates?: string | null; displayIcon?: string | null; splash?: string | null; listViewIcon?: string | null; callouts?: unknown[] | null }
export interface VSkin { uuid: string; displayName: string; contentTierUuid?: string | null; displayIcon?: string | null; wallpaper?: string | null; chromas?: { displayIcon?: string | null }[]; levels?: unknown[] }
export interface VWeapon {
  uuid: string; displayName: string; category: string; displayIcon?: string;
  weaponStats?: { fireRate: number; magazineSize: number; reloadTimeSeconds: number; equipTimeSeconds: number; runSpeedMultiplier: number; wallPenetration: string; firstBulletAccuracy: number; damageRanges?: { rangeStartMeters: number; rangeEndMeters: number; headDamage: number; bodyDamage: number; legDamage: number }[] } | null;
  shopData?: { cost: number; categoryText: string } | null; skins: VSkin[];
}
export interface VSeason { uuid: string; displayName: string; title?: string | null; type?: string | null; startTime: string; endTime: string; parentUuid?: string | null }

const va = <T>(path: string, cacheMs = 6 * HOUR) => getJson<{ data: T }>(`https://valorant-api.com/v1/${path}`, { cacheMs, timeoutMs: 30_000 }).then(r => r.data);
export const vAgents = () => va<VAgent[]>('agents?isPlayableCharacter=true');
export const vMaps = () => va<VMap[]>('maps');
export const vWeapons = () => va<VWeapon[]>('weapons');
export const vSeasons = () => va<VSeason[]>('seasons');
export const vTiers = () => va<{ uuid: string; displayName: string; devName: string; highlightColor: string; displayIcon: string }[]>('contenttiers');

export function findByName<T extends { displayName: string }>(items: T[], q: string): T | null {
  const s = q.trim().toLowerCase();
  return items.find(i => i.displayName.toLowerCase() === s) ?? items.find(i => i.displayName.toLowerCase().startsWith(s)) ?? items.find(i => i.displayName.toLowerCase().includes(s)) ?? null;
}
export function findSkin(weapons: VWeapon[], q: string): { skin: VSkin; weapon: VWeapon } | null {
  const s = q.trim().toLowerCase();
  const all = weapons.flatMap(w => w.skins.map(skin => ({ skin, weapon: w })));
  return all.find(x => x.skin.displayName.toLowerCase() === s) ?? all.find(x => x.skin.displayName.toLowerCase().includes(s)) ?? null;
}

/** Episodes (seasons with children) and their acts, oldest first, marking whichever contains `now`. */
export function seasonTimeline(seasons: VSeason[], now = Date.now()) {
  const kids = new Map<string, VSeason[]>();
  for (const s of seasons) if (s.parentUuid) kids.set(s.parentUuid, [...(kids.get(s.parentUuid) ?? []), s]);
  return seasons.filter(s => !s.parentUuid && kids.has(s.uuid)).sort((a, b) => a.startTime.localeCompare(b.startTime)).map(ep => ({
    episode: ep,
    acts: (kids.get(ep.uuid) ?? []).sort((a, b) => a.startTime.localeCompare(b.startTime)).map(a => ({ act: a, current: Date.parse(a.startTime) <= now && now < Date.parse(a.endTime) })),
    current: Date.parse(ep.startTime) <= now && now < Date.parse(ep.endTime),
  }));
}

// ─── Fortnite (fortnite-api.com) ─────────────────────────────────────────────

export interface FnCosmetic { id: string; name: string; description: string; type?: { displayValue: string }; rarity?: { displayValue: string; value: string }; introduction?: { text: string }; images?: { icon?: string; featured?: string; smallIcon?: string }; added?: string; series?: { value: string } | null; set?: { text: string } | null; shopHistory?: string[] | null }
export async function fnCosmetic(name: string): Promise<FnCosmetic> {
  try { return (await getJson<{ data: FnCosmetic }>(`https://fortnite-api.com/v2/cosmetics/br/search?name=${encodeURIComponent(name.trim())}`, { cacheMs: MIN5 })).data; }
  catch (e) { if (e instanceof HttpError && e.status === 404) throw new LookupError(`I couldn't find a Fortnite cosmetic called **${name}**.`); throw e; }
}
export interface FnMap { images: { blank: string; pois: string }; pois: { name: string }[] }
export const fnMap = () => getJson<{ data: FnMap }>('https://fortnite-api.com/v1/map', { cacheMs: HOUR }).then(r => r.data);

export interface FnShopEntry { regularPrice: number; finalPrice: number; layout?: { name?: string } | null; bundle?: { name: string } | null; brItems?: { name: string; images?: { icon?: string } }[]; outDate?: string }
export interface FnShop { date: string; entries: FnShopEntry[] }
export const fnShop = () => getJson<{ data: FnShop }>('https://fortnite-api.com/v2/shop', { cacheMs: 30 * 60_000, timeoutMs: 30_000 }).then(r => r.data);
/** Group shop entries by section name → lines like "Name — 1,500 V-Bucks". */
export function shopSections(shop: FnShop, perSection = 8, maxSections = 6): { name: string; lines: string[]; total: number }[] {
  const by = new Map<string, string[]>();
  for (const e of shop.entries) {
    const label = e.bundle?.name ?? e.brItems?.map(i => i.name).join(' + ') ?? '';
    if (!label) continue;
    const sec = e.layout?.name || 'Other';
    by.set(sec, [...(by.get(sec) ?? []), `${label} — ${e.finalPrice.toLocaleString('en-US')} V-Bucks${e.regularPrice > e.finalPrice ? ' (sale)' : ''}`]);
  }
  return [...by.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, maxSections).map(([name, lines]) => ({ name, lines: lines.slice(0, perSection), total: lines.length }));
}

// ─── YouTube search (through yt-dlp) ─────────────────────────────────────────

export interface YtResult { id: string; title: string; channel?: string; duration?: number; views?: number; url: string }
export function parseYtLines(out: string): YtResult[] {
  const results: YtResult[] = [];
  for (const line of out.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const j = JSON.parse(line) as { id: string; title: string; channel?: string; uploader?: string; duration?: number; view_count?: number };
      if (j.id && j.title) results.push({ id: j.id, title: j.title, channel: j.channel ?? j.uploader, duration: j.duration, views: j.view_count, url: `https://www.youtube.com/watch?v=${j.id}` });
    } catch { /* not a JSON line */ }
  }
  return results;
}
export const YTDLP = Bun.env.YTDLP_PATH ?? 'yt-dlp';
export async function ytSearch(query: string, n = 5): Promise<YtResult[]> {
  const q = query.trim().slice(0, 120);
  if (!q) throw new LookupError('What should I search for?');
  const proc = Bun.spawn([YTDLP, '--flat-playlist', '--dump-json', '--no-warnings', `ytsearch${n}:${q}`], { stdout: 'pipe', stderr: 'pipe' });
  let timedOut = false;
  const t = setTimeout(() => { timedOut = true; proc.kill(); }, 30_000);
  try {
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (timedOut) throw new LookupError('YouTube took too long to answer.');
    if (code !== 0) throw new LookupError(`YouTube search failed${err ? `: ${err.trim().split('\n').at(-1)!.slice(0, 120)}` : ''}.`);
    return parseYtLines(out);
  } catch (e) {
    if ((e as { code?: string })?.code === 'ENOENT') throw new LookupError('YouTube search needs yt-dlp, which isn\'t installed on the bot\'s host.');
    throw e;
  } finally { clearTimeout(t); }
}
export function fmtDuration(seconds?: number): string {
  if (!seconds) return 'live';
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
