import he from 'he';
import { getJson, getText, USER_AGENT } from '../framework/http.js';
import { LookupError } from './handler.js';
import { parseSearx, parseWikipedia, stripTags, type SearchHit } from './web.js';

/**
 * /search text|images|news|grokipedia. With SEARXNG_URL (your own instance) every engine SearXNG knows is available;
 * without it, text/images/news come from DuckDuckGo (keyless) and Wikipedia is the last fallback for text.
 */

export type Safe = 'moderate' | 'on' | 'off';
export const safeOf = (c: string | null | undefined): Safe => ((c ?? 'Moderate').toLowerCase() as Safe);
export const ENGINES = ['duckduckgo', 'google', 'bing', 'brave', 'startpage', 'qwant', 'mojeek', 'wikipedia'];
const searx = () => Bun.env.SEARXNG_URL?.replace(/\/$/, '');
const searxSafe = (s: Safe) => (s === 'off' ? 0 : s === 'on' ? 2 : 1);
const ddgSafe = (s: Safe) => (s === 'off' ? '-2' : s === 'on' ? '1' : '-1');
/** "d" / "w" / "m" (Heist's time filter) → SearXNG's time_range. */
export const timeRange = (t: string | null | undefined) => ({ d: 'day', w: 'week', m: 'month', y: 'year' } as Record<string, string>)[(t ?? '').trim().toLowerCase().charAt(0)] ?? null;

function checkQuery(q: string) {
  const s = q.trim();
  if (!s || s.length > 200) throw new LookupError('Give me something to search for (up to 200 characters).');
  return s;
}

/** DuckDuckGo's HTML results: result__a links wrap the real URL in a uddg= redirect. */
export function parseDdgHtml(html: string): SearchHit[] {
  const out: SearchHit[] = [];
  const links = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  for (const [n, m] of links.entries()) {
    // The snippet belongs to this result if it appears before the next result link.
    const block = html.slice(m.index! + m[0].length, links[n + 1]?.index ?? html.length);
    const snippet = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1] ?? '';
    let url = he.decode(m[1]!);
    const u = /[?&]uddg=([^&]+)/.exec(url);
    if (u) url = decodeURIComponent(u[1]!);
    if (url.startsWith('//')) url = `https:${url}`;
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue; // skip ads
    out.push({ title: stripTags(m[2]!), url, snippet: stripTags(snippet), source: 'DuckDuckGo' });
  }
  return out;
}

export async function webSearch(query: string, o: { engine?: string | null; safe?: Safe; limit?: number } = {}): Promise<{ hits: SearchHit[]; engine: string }> {
  const q = checkQuery(query);
  const limit = o.limit ?? 8, safe = o.safe ?? 'moderate';
  const engine = o.engine?.trim().toLowerCase() || null;
  if (searx()) {
    try {
      const hits = parseSearx(await getJson(`${searx()}/search?q=${encodeURIComponent(q)}&format=json&safesearch=${searxSafe(safe)}${engine ? `&engines=${encodeURIComponent(engine)}` : ''}`, { cacheMs: 10 * 60_000 })).slice(0, limit);
      if (hits.length) return { hits, engine: engine ?? 'SearXNG' };
    } catch { /* fall through */ }
  }
  if (engine !== 'wikipedia') {
    try {
      const html = await getText('https://html.duckduckgo.com/html/', { method: 'POST', body: new URLSearchParams({ q, kp: ddgSafe(safe) }), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT }, timeoutMs: 12_000 });
      const hits = parseDdgHtml(html).slice(0, limit);
      if (hits.length) return { hits, engine: 'DuckDuckGo' };
    } catch { /* fall through */ }
  }
  const hits = parseWikipedia(await getJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=${limit}&utf8=1`, { cacheMs: 10 * 60_000 }));
  if (!hits.length) throw new LookupError(`No results for **${q.slice(0, 80)}**.`);
  return { hits, engine: 'Wikipedia' };
}

/** DuckDuckGo's image/news endpoints need a per-query token (vqd) from the search page. */
export const parseVqd = (html: string) => /vqd=["']?([\d-]+)["']?/.exec(html)?.[1] ?? null;
async function vqd(q: string): Promise<string> {
  const t = parseVqd(await getText(`https://duckduckgo.com/?q=${encodeURIComponent(q)}&ia=web`, { cacheMs: 10 * 60_000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36' } }));
  if (!t) throw new LookupError('The search service didn\'t answer — try again.');
  return t;
}

export interface ImageHit { title: string; image: string; thumb?: string; source: string; width?: number; height?: number }

export async function imageSearch(query: string, o: { engine?: string | null; safe?: Safe; time?: string | null } = {}): Promise<ImageHit[]> {
  const q = checkQuery(query), safe = o.safe ?? 'moderate', tr = timeRange(o.time);
  if (searx()) {
    try {
      const r = await getJson<{ results?: { title: string; img_src?: string; thumbnail_src?: string; url: string; resolution?: string }[] }>(`${searx()}/search?q=${encodeURIComponent(q)}&format=json&categories=images&safesearch=${searxSafe(safe)}${tr ? `&time_range=${tr}` : ''}${o.engine ? `&engines=${encodeURIComponent(o.engine)}` : ''}`, { cacheMs: 10 * 60_000 });
      const hits = (r.results ?? []).filter(x => /^https:\/\//.test(x.img_src ?? '')).map(x => ({ title: stripTags(x.title), image: x.img_src!, thumb: x.thumbnail_src, source: x.url }));
      if (hits.length) return hits.slice(0, 25);
    } catch { /* fall through */ }
  }
  const token = await vqd(q);
  const df = tr ? `&f=time:${tr === 'day' ? 'Day' : tr === 'week' ? 'Week' : 'Month'}` : '';
  const r = await getJson<{ results?: { title: string; image: string; thumbnail?: string; url: string; width?: number; height?: number }[] }>(
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(q)}&vqd=${token}&p=${ddgSafe(safe)}${df}`, { cacheMs: 10 * 60_000, headers: { Referer: 'https://duckduckgo.com/' } });
  const hits = (r.results ?? []).filter(x => /^https:\/\//.test(x.image)).map(x => ({ title: x.title, image: x.image, thumb: x.thumbnail, source: x.url, width: x.width, height: x.height }));
  if (!hits.length) throw new LookupError(`No images for **${q.slice(0, 80)}**.`);
  return hits.slice(0, 25);
}

export interface NewsHit { title: string; url: string; excerpt: string; source?: string; date?: number; image?: string }

export async function newsSearch(query: string, o: { engine?: string | null; safe?: Safe; time?: string | null } = {}): Promise<NewsHit[]> {
  const q = checkQuery(query), safe = o.safe ?? 'moderate', tr = timeRange(o.time);
  if (searx()) {
    try {
      const r = await getJson<{ results?: { title: string; url: string; content?: string; engine?: string; publishedDate?: string; thumbnail?: string }[] }>(`${searx()}/search?q=${encodeURIComponent(q)}&format=json&categories=news&safesearch=${searxSafe(safe)}${tr ? `&time_range=${tr}` : ''}${o.engine ? `&engines=${encodeURIComponent(o.engine)}` : ''}`, { cacheMs: 5 * 60_000 });
      const hits = (r.results ?? []).map(x => ({ title: stripTags(x.title), url: x.url, excerpt: stripTags(x.content ?? ''), source: x.engine, date: x.publishedDate ? Date.parse(x.publishedDate) : undefined, image: x.thumbnail }));
      if (hits.length) return hits.slice(0, 20);
    } catch { /* fall through */ }
  }
  const token = await vqd(q);
  const r = await getJson<{ results?: { title: string; url: string; excerpt?: string; source?: string; date?: number; image?: string }[] }>(
    `https://duckduckgo.com/news.js?l=us-en&o=json&noamp=1&q=${encodeURIComponent(q)}&vqd=${token}&p=${ddgSafe(safe)}${tr ? `&df=${tr.charAt(0)}` : ''}`, { cacheMs: 5 * 60_000, headers: { Referer: 'https://duckduckgo.com/' } });
  const hits = (r.results ?? []).map(x => ({ title: he.decode(x.title), url: x.url, excerpt: stripTags(x.excerpt ?? ''), source: x.source, date: x.date ? x.date * 1000 : undefined, image: x.image }));
  if (!hits.length) throw new LookupError(`No news for **${q.slice(0, 80)}**.`);
  return hits.slice(0, 20);
}

// ─── Grokipedia ──────────────────────────────────────────────────────────────

export interface GrokHit { title: string; slug: string; snippet: string; url: string; views?: number }

export function parseGrok(raw: unknown): GrokHit[] {
  const r = raw as { results?: unknown[]; data?: unknown[]; items?: unknown[] };
  const list = (r.results ?? r.data ?? r.items ?? (Array.isArray(raw) ? raw : [])) as Record<string, unknown>[];
  return list.map(x => {
    const slug = String(x.slug ?? x.id ?? '').trim();
    const title = String(x.title ?? slug.replace(/_/g, ' '));
    return { title: stripTags(title), slug, snippet: stripTags(String(x.snippet ?? x.description ?? x.excerpt ?? '')), url: `https://grokipedia.com/page/${encodeURIComponent(slug)}`, views: x.viewCount != null ? Number(x.viewCount) : undefined };
  }).filter(h => h.slug);
}

export async function grokipedia(query: string, limit = 20): Promise<GrokHit[]> {
  const q = checkQuery(query);
  const n = Math.max(1, Math.min(40, limit));
  let raw: unknown;
  try { raw = await getJson(`https://grokipedia.com/api/full-text-search?query=${encodeURIComponent(q)}&limit=${n}&offset=0`, { cacheMs: 30 * 60_000, timeoutMs: 15_000 }); }
  catch { throw new LookupError('Grokipedia\'s search isn\'t answering right now (it has no official public API, so it can change without notice).'); }
  const hits = parseGrok(raw).slice(0, n);
  if (!hits.length) throw new LookupError(`Grokipedia has nothing for **${q.slice(0, 80)}**.`);
  return hits;
}
