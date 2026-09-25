import he from 'he';
import { getJson, getText, HttpError } from '../framework/http.js';
import { LookupError } from './handler.js';
import { unshorten } from './bypass.js';

/**
 * Public profile lookups for Instagram, Snapchat, Cash App, guns.lol, haunt.gg and Pinterest.
 * Each site is read the way its own web page loads it (public JSON endpoints or the data embedded in the page) — no logins, no private data.
 * Parsing is kept separate from fetching so it can be tested against captured responses.
 */

const PAGE_CACHE = 5 * 60_000;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

export const metaTag = (html: string, prop: string) => {
  const m = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, 'i').exec(html)
    ?? new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, 'i').exec(html);
  return m ? he.decode(m[1]!).trim() : undefined;
};

export function nextData<T = unknown>(html: string): T | null {
  const m = /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]!) as T; } catch { return null; }
}

const handle = (s: string, re: RegExp, what: string) => {
  const h = s.trim().replace(/^@|^\$/, '').replace(/^https?:\/\/[^/]+\//i, '').replace(/^(add|\$)\/?/i, '').split(/[/?#]/)[0]!.replace(/^\$/, '');
  if (!re.test(h)) throw new LookupError(`That isn't a valid ${what} username.`);
  return h;
};

// ─── Instagram ───────────────────────────────────────────────────────────────

export interface IgUser { username: string; name?: string; bio?: string; avatar?: string; followers?: number; following?: number; posts?: number; verified: boolean; private: boolean; link?: string; category?: string }

export function parseIgUser(raw: { data?: { user?: Record<string, unknown> | null } }): IgUser | null {
  const u = raw.data?.user as undefined | { username: string; full_name?: string; biography?: string; profile_pic_url_hd?: string; profile_pic_url?: string; edge_followed_by?: { count: number }; edge_follow?: { count: number }; edge_owner_to_timeline_media?: { count: number }; is_verified?: boolean; is_private?: boolean; external_url?: string | null; category_name?: string | null };
  if (!u?.username) return null;
  return {
    username: u.username, name: u.full_name || undefined, bio: u.biography || undefined, avatar: u.profile_pic_url_hd || u.profile_pic_url, followers: u.edge_followed_by?.count,
    following: u.edge_follow?.count, posts: u.edge_owner_to_timeline_media?.count, verified: !!u.is_verified, private: !!u.is_private, link: u.external_url || undefined, category: u.category_name || undefined,
  };
}

export async function instagramUser(input: string): Promise<IgUser> {
  const u = handle(input, /^[A-Za-z0-9._]{1,30}$/, 'Instagram');
  let raw: Parameters<typeof parseIgUser>[0];
  try {
    raw = await getJson(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(u)}`, {
      cacheMs: PAGE_CACHE, timeoutMs: 15_000, headers: { 'x-ig-app-id': '936619743392459', 'User-Agent': BROWSER_UA, Accept: 'application/json' },
    });
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) throw new LookupError(`There's no Instagram account called **@${u}**.`);
    if (e instanceof HttpError && [401, 403, 429].includes(e.status)) throw new LookupError('Instagram is refusing lookups from this bot right now (it rate-limits servers hard). Try again later.');
    throw e;
  }
  const p = parseIgUser(raw);
  if (!p) throw new LookupError(`There's no Instagram account called **@${u}**.`);
  return p;
}

// ─── Snapchat ────────────────────────────────────────────────────────────────

export interface SnapUser { username: string; name?: string; bio?: string; avatar?: string; snapcode?: string; subscribers?: number; website?: string; public: boolean; hero?: string }

export function parseSnap(html: string, fallback: string): SnapUser | null {
  const d = nextData<{ props?: { pageProps?: { userProfile?: { publicProfileInfo?: Record<string, unknown>; userInfo?: Record<string, unknown> } } } }>(html);
  const up = d?.props?.pageProps?.userProfile;
  const pub = up?.publicProfileInfo as undefined | { username?: string; title?: string; bio?: string; profilePictureUrl?: string; snapcodeImageUrl?: string; subscriberCount?: string | number; websiteUrl?: string; squareHeroImageUrl?: string };
  if (pub?.username || pub?.title) {
    return { username: pub.username ?? fallback, name: pub.title, bio: pub.bio || undefined, avatar: pub.profilePictureUrl, snapcode: pub.snapcodeImageUrl, subscribers: pub.subscriberCount != null ? Number(pub.subscriberCount) : undefined, website: pub.websiteUrl || undefined, public: true, hero: pub.squareHeroImageUrl };
  }
  const ui = up?.userInfo as undefined | { username?: string; displayName?: string; snapcodeImageUrl?: string; bitmoji3d?: { avatarImage?: { url?: string } } };
  if (ui?.username) return { username: ui.username, name: ui.displayName, avatar: ui.bitmoji3d?.avatarImage?.url, snapcode: ui.snapcodeImageUrl, public: false };
  const title = metaTag(html, 'og:title');
  if (title && !/^Snapchat$/i.test(title)) return { username: fallback, name: title.replace(/\s*\(@[^)]+\).*$/, '').replace(/ on Snapchat$/i, ''), avatar: metaTag(html, 'og:image'), bio: metaTag(html, 'og:description'), public: false };
  return null;
}

export async function snapchatUser(input: string): Promise<SnapUser> {
  const u = handle(input, /^[A-Za-z][\w.-]{2,14}$/, 'Snapchat');
  let html: string;
  try { html = await getText(`https://www.snapchat.com/add/${encodeURIComponent(u)}`, { cacheMs: PAGE_CACHE, headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en' } }); }
  catch (e) { if (e instanceof HttpError && e.status === 404) throw new LookupError(`There's no Snapchat account called **${u}**.`); throw e; }
  const p = parseSnap(html, u);
  if (!p) throw new LookupError(`There's no Snapchat account called **${u}**.`);
  return p;
}

// ─── Cash App ────────────────────────────────────────────────────────────────

export interface CashUser { cashtag: string; name?: string; avatar?: string; verified: boolean; accent?: string; initial?: string }

export function parseCash(html: string, fallback: string): CashUser | null {
  const m = /var\s+profile\s*=\s*(\{[\s\S]*?\});\s*(?:var|<\/script>|\n)/.exec(html);
  if (m) {
    try {
      const p = JSON.parse(m[1]!) as { display_name?: string; formatted_cashtag?: string; avatar?: { image_url?: string | null; initial?: string; accent_color?: string }; is_verified_account?: boolean };
      return { cashtag: (p.formatted_cashtag ?? `$${fallback}`).replace(/^\$?/, '$'), name: p.display_name, avatar: p.avatar?.image_url ?? undefined, verified: !!p.is_verified_account, accent: p.avatar?.accent_color, initial: p.avatar?.initial };
    } catch { /* fall through */ }
  }
  const title = metaTag(html, 'og:title');
  // The generic page title ("Cash App") means the cashtag doesn't exist.
  if (!title || /^Cash App\b/i.test(title)) return null;
  return { cashtag: `$${fallback}`, name: title.replace(/^Pay\s+/i, '').replace(/\s+on Cash App$/i, ''), avatar: metaTag(html, 'og:image'), verified: false };
}

export async function cashappUser(input: string): Promise<CashUser> {
  const u = handle(input, /^[A-Za-z][A-Za-z0-9_]{0,19}$/, 'Cash App');
  let html: string;
  try { html = await getText(`https://cash.app/$${encodeURIComponent(u)}`, { cacheMs: PAGE_CACHE, headers: { 'User-Agent': BROWSER_UA } }); }
  catch (e) { if (e instanceof HttpError && e.status === 404) throw new LookupError(`There's no Cash App account **$${u}**.`); throw e; }
  const p = parseCash(html, u);
  if (!p) throw new LookupError(`There's no Cash App account **$${u}**.`);
  return p;
}

// ─── Bio pages (guns.lol, haunt.gg) ──────────────────────────────────────────

export interface BioPage { site: string; username: string; title?: string; description?: string; image?: string; url: string }

export function parseBioPage(html: string, site: string, username: string, url: string): BioPage | null {
  const title = metaTag(html, 'og:title') ?? /<title>([^<]+)<\/title>/i.exec(html)?.[1]?.trim();
  if (!title || /not\s*found|404|doesn.?t exist|claim this/i.test(title)) return null;
  return { site, username, title: he.decode(title), description: metaTag(html, 'og:description') ?? metaTag(html, 'description'), image: metaTag(html, 'og:image'), url };
}

export async function bioPage(site: 'guns.lol' | 'haunt.gg', input: string): Promise<BioPage> {
  const u = handle(input, /^[\w.-]{1,32}$/, site);
  const url = `https://${site}/${encodeURIComponent(u)}`;
  let html: string;
  try { html = await getText(url, { cacheMs: PAGE_CACHE, headers: { 'User-Agent': BROWSER_UA } }); }
  catch (e) { if (e instanceof HttpError && e.status === 404) throw new LookupError(`There's no ${site} page called **${u}**.`); throw e; }
  const p = parseBioPage(html, site, u, url);
  if (!p) throw new LookupError(`There's no ${site} page called **${u}**.`);
  return p;
}

// ─── Pinterest ───────────────────────────────────────────────────────────────

export interface Pin { id: string; title?: string; description?: string; image?: string; width?: number; height?: number; pinner?: string; pinnerName?: string; board?: string; saves?: number; link?: string; url: string; video?: string; created?: number }

type PinRaw = {
  id: string; title?: string; grid_title?: string; description?: string; link?: string | null; repin_count?: number; created_at?: string;
  images?: Record<string, { url: string; width?: number; height?: number }>; pinner?: { username?: string; full_name?: string }; board?: { name?: string };
  videos?: { video_list?: Record<string, { url: string }> } | null;
};

export function parsePin(p: PinRaw): Pin {
  const img = p.images?.orig ?? p.images?.['736x'] ?? p.images?.['564x'] ?? Object.values(p.images ?? {})[0];
  const vid = p.videos?.video_list ? (p.videos.video_list.V_720P ?? p.videos.video_list.V_EXP7 ?? Object.values(p.videos.video_list).find(v => /\.mp4/.test(v.url))) : undefined;
  return {
    id: p.id, title: (p.title || p.grid_title || '').trim() || undefined, description: p.description?.trim() || undefined, image: img?.url, width: img?.width, height: img?.height,
    pinner: p.pinner?.username, pinnerName: p.pinner?.full_name, board: p.board?.name, saves: p.repin_count, link: p.link ?? undefined,
    url: `https://www.pinterest.com/pin/${p.id}/`, video: vid?.url, created: p.created_at ? Date.parse(p.created_at) || undefined : undefined,
  };
}

export function parsePinSearch(raw: { resource_response?: { data?: { results?: PinRaw[] } } }): Pin[] {
  return (raw.resource_response?.data?.results ?? []).filter(r => r?.id && r.images).map(parsePin).filter(p => !!p.image);
}

export async function pinterestSearch(query: string, size = 25): Promise<Pin[]> {
  const q = query.trim();
  if (!q || q.length > 100) throw new LookupError('Give me something to search for (up to 100 characters).');
  const data = { options: { query: q, scope: 'pins', page_size: size, rs: 'typed' }, context: {} };
  const url = `https://www.pinterest.com/resource/BaseSearchResource/get/?source_url=${encodeURIComponent(`/search/pins/?q=${q}`)}&data=${encodeURIComponent(JSON.stringify(data))}`;
  const pins = parsePinSearch(await getJson(url, { cacheMs: 30 * 60_000, timeoutMs: 15_000, headers: { 'User-Agent': BROWSER_UA, 'X-Requested-With': 'XMLHttpRequest', 'X-Pinterest-PWS-Handler': 'www/search/[scope].js' } }));
  if (!pins.length) throw new LookupError(`No Pinterest results for **${q}**.`);
  return pins;
}

export async function pinId(input: string): Promise<string> {
  let s = input.trim();
  if (/^https?:\/\/pin\.it\//i.test(s)) s = (await unshorten(s)).final;
  const m = /pinterest\.[a-z.]+\/pin\/(?:[\w-]*--)?(\d{5,25})/i.exec(s) ?? /^(\d{5,25})$/.exec(s);
  if (!m) throw new LookupError('Send a Pinterest pin link like `https://www.pinterest.com/pin/123…/` or `https://pin.it/…`.');
  return m[1]!;
}

export async function pinterestPin(input: string): Promise<Pin> {
  const id = await pinId(input);
  const r = await getJson<{ status?: string; data?: PinRaw[] }>(`https://widgets.pinterest.com/v3/pidgets/pins/info/?pin_ids=${id}`, { cacheMs: PAGE_CACHE });
  const p = r.data?.[0];
  if (!p) throw new LookupError('That pin doesn\'t exist or isn\'t public.');
  return parsePin(p);
}
