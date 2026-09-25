import he from 'he';
import { getJson } from '../framework/http.js';
import { LookupError } from './handler.js';

/** Keyless web lookups: Urban Dictionary, lyrics (LRCLIB), paste.rs, search (SearXNG if configured, else Wikipedia), anime action GIFs (nekos.best), tweet previews (vxtwitter). */

const HOUR = 3_600_000;

// ─── Urban Dictionary ────────────────────────────────────────────────────────

export interface UrbanDef { word: string; definition: string; example: string; author: string; up: number; down: number; url: string; date: string }
interface UrbanRaw { list: { word: string; definition: string; example: string; author: string; thumbs_up: number; thumbs_down: number; permalink: string; written_on: string }[] }

/** "[word]" links become bold; carriage returns collapse. */
export const cleanUrban = (s: string) => s.replace(/\[([^\]]+)\]/g, '**$1**').replace(/\r/g, '').trim();

export async function urban(term: string, index = 0): Promise<{ def: UrbanDef; total: number }> {
  const t = term.trim();
  if (!t || t.length > 100) throw new LookupError('Give me a word or phrase (up to 100 characters).');
  const r = await getJson<UrbanRaw>(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(t)}`, { cacheMs: HOUR });
  const list = r.list ?? [];
  if (!list.length) throw new LookupError(`Urban Dictionary has nothing for **${t.slice(0, 60)}**.`);
  const d = list[Math.min(Math.max(0, index), list.length - 1)]!;
  return { total: list.length, def: { word: d.word, definition: cleanUrban(d.definition), example: cleanUrban(d.example), author: d.author, up: d.thumbs_up, down: d.thumbs_down, url: d.permalink, date: d.written_on } };
}

// ─── Lyrics ──────────────────────────────────────────────────────────────────

export interface Lyrics { title: string; artist: string; album?: string; duration?: number; text: string; instrumental: boolean }
interface LrcRaw { trackName: string; artistName: string; albumName?: string; duration?: number; plainLyrics?: string | null; instrumental?: boolean }

export function pickLyrics(list: LrcRaw[]): Lyrics | undefined {
  const hit = list.find(t => t.plainLyrics && t.plainLyrics.trim()) ?? list.find(t => t.instrumental);
  return hit && { title: hit.trackName, artist: hit.artistName, album: hit.albumName, duration: hit.duration, text: (hit.plainLyrics ?? '').trim(), instrumental: !!hit.instrumental && !hit.plainLyrics };
}

export async function lyrics(query: string): Promise<Lyrics> {
  const q = query.trim();
  if (q.length < 2 || q.length > 150) throw new LookupError('Give me a song title (and artist if you can), like `never gonna give you up rick astley`.');
  const r = await getJson<LrcRaw[]>(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, { cacheMs: HOUR });
  const l = pickLyrics(r ?? []);
  if (!l) throw new LookupError(`I couldn't find lyrics for **${q.slice(0, 80)}**.`);
  return l;
}

/** Splits lyrics into pages of at most `max` characters on line boundaries. */
export function paginate(text: string, max = 1800): string[] {
  const pages: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    const l = line.length > max ? line.slice(0, max) : line;
    if (cur && cur.length + l.length + 1 > max) { pages.push(cur.trim()); cur = ''; }
    cur += `${l}\n`;
  }
  if (cur.trim()) pages.push(cur.trim());
  return pages.length ? pages : [''];
}

// ─── paste.rs ────────────────────────────────────────────────────────────────

export const PASTE_MAX = 100_000;

/** Pastebin (unlisted) when PASTEBIN_API_KEY is set; otherwise paste.rs, which has no titles, so the title becomes the first line. */
export async function paste(text: string, title?: string): Promise<string> {
  if (!text.trim()) throw new LookupError('There\'s nothing to paste.');
  if (Buffer.byteLength(text) > PASTE_MAX) throw new LookupError(`That's too long to paste (limit ${PASTE_MAX / 1000} KB).`);
  const key = Bun.env.PASTEBIN_API_KEY;
  if (key) {
    const body = new URLSearchParams({ api_dev_key: key, api_option: 'paste', api_paste_code: text, api_paste_private: '1', api_paste_expire_date: 'N', ...(title ? { api_paste_name: title.slice(0, 100) } : {}) });
    const res = await fetch('https://pastebin.com/api/api_post.php', { method: 'POST', body, headers: { 'User-Agent': 'BestowBot/1.0' }, signal: AbortSignal.timeout(15_000) });
    const out = (await res.text()).trim();
    if (!/^https:\/\/pastebin\.com\/[A-Za-z0-9]+$/.test(out)) throw new LookupError('Pastebin didn\'t accept that.');
    return out;
  }
  const withTitle = title ? `${title}\n${'='.repeat(Math.min(title.length, 80))}\n\n${text}` : text;
  const url = (await (await fetch('https://paste.rs/', { method: 'POST', body: withTitle, headers: { 'User-Agent': 'BestowBot/1.0', 'Content-Type': 'text/plain; charset=utf-8' }, signal: AbortSignal.timeout(15_000) })).text()).trim();
  if (!/^https:\/\/paste\.rs\/[A-Za-z0-9]+/.test(url)) throw new LookupError('The paste service didn\'t accept that.');
  return url.split(/\s/)[0]!;
}

// ─── Search ──────────────────────────────────────────────────────────────────

export interface SearchHit { title: string; url: string; snippet: string; source: string }

export const stripTags = (s: string) => he.decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

export function parseWikipedia(raw: { query?: { search?: { title: string; snippet: string }[] } }, host = 'en.wikipedia.org'): SearchHit[] {
  return (raw.query?.search ?? []).map(s => ({ title: s.title, url: `https://${host}/wiki/${encodeURIComponent(s.title.replace(/ /g, '_'))}`, snippet: stripTags(s.snippet), source: 'Wikipedia' }));
}

export function parseSearx(raw: { results?: { title: string; url: string; content?: string; engine?: string }[] }): SearchHit[] {
  return (raw.results ?? []).filter(r => /^https?:\/\//.test(r.url)).map(r => ({ title: stripTags(r.title), url: r.url, snippet: stripTags(r.content ?? ''), source: r.engine ?? 'SearXNG' }));
}

/** Uses your own SearXNG instance when SEARXNG_URL is set (best results), otherwise Wikipedia. */
export async function search(query: string, limit = 5): Promise<{ hits: SearchHit[]; engine: string }> {
  const q = query.trim();
  if (!q || q.length > 200) throw new LookupError('Give me something to search for (up to 200 characters).');
  const searx = Bun.env.SEARXNG_URL?.replace(/\/$/, '');
  if (searx) {
    try {
      const hits = parseSearx(await getJson(`${searx}/search?q=${encodeURIComponent(q)}&format=json&safesearch=1`, { cacheMs: 10 * 60_000 })).slice(0, limit);
      if (hits.length) return { hits, engine: 'SearXNG' };
    } catch { /* fall through to Wikipedia */ }
  }
  const raw = await getJson<Parameters<typeof parseWikipedia>[0]>(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=${limit}&utf8=1`, { cacheMs: 10 * 60_000 });
  const hits = parseWikipedia(raw);
  if (!hits.length) throw new LookupError(`No results for **${q.slice(0, 80)}**.`);
  return { hits, engine: 'Wikipedia' };
}

// ─── Anime action GIFs ───────────────────────────────────────────────────────

/** verb template: `{a}` is the sender, `{b}` the target. */
export const ACTIONS: Record<string, { text: string; solo: string }> = {
  hug: { text: '{a} hugs {b}', solo: '{a} needs a hug' }, pat: { text: '{a} pats {b}', solo: '{a} pats themselves' }, kiss: { text: '{a} kisses {b}', solo: '{a} blows a kiss' },
  slap: { text: '{a} slaps {b}', solo: '{a} slaps the air' }, cuddle: { text: '{a} cuddles {b}', solo: '{a} cuddles up' }, poke: { text: '{a} pokes {b}', solo: '{a} pokes around' },
  bite: { text: '{a} bites {b}', solo: '{a} bites down' }, punch: { text: '{a} punches {b}', solo: '{a} throws a punch' }, kick: { text: '{a} kicks {b}', solo: '{a} kicks the air' },
  wave: { text: '{a} waves at {b}', solo: '{a} waves' }, dance: { text: '{a} dances with {b}', solo: '{a} dances' }, cry: { text: '{a} cries on {b}', solo: '{a} cries' },
  laugh: { text: '{a} laughs at {b}', solo: '{a} laughs' }, blush: { text: '{a} blushes at {b}', solo: '{a} blushes' }, smile: { text: '{a} smiles at {b}', solo: '{a} smiles' },
  highfive: { text: '{a} high-fives {b}', solo: '{a} high-fives the air' }, handhold: { text: '{a} holds hands with {b}', solo: '{a} reaches out a hand' }, facepalm: { text: '{a} facepalms at {b}', solo: '{a} facepalms' },
  wink: { text: '{a} winks at {b}', solo: '{a} winks' }, yeet: { text: '{a} yeets {b}', solo: '{a} yeets themselves' }, bonk: { text: '{a} bonks {b}', solo: '{a} bonks themselves' },
  tickle: { text: '{a} tickles {b}', solo: '{a} giggles' }, feed: { text: '{a} feeds {b}', solo: '{a} eats' }, stare: { text: '{a} stares at {b}', solo: '{a} stares into the void' },
  baka: { text: '{a} calls {b} a baka', solo: '{a} shouts BAKA' }, handshake: { text: '{a} shakes hands with {b}', solo: '{a} offers a handshake' },
  peck: { text: '{a} gives {b} a peck', solo: '{a} blows a little kiss' }, shoot: { text: '{a} shoots {b}', solo: '{a} fires into the air' },
};

export function actionText(kind: string, a: string, b?: string): string {
  const t = Object.hasOwn(ACTIONS, kind) ? ACTIONS[kind]! : undefined;
  if (!t) throw new LookupError('Unknown action.');
  return (b ? t.text : t.solo).replace('{a}', a).replace('{b}', b ?? '');
}

export async function actionGif(kind: string): Promise<{ url: string; anime?: string }> {
  if (!Object.hasOwn(ACTIONS, kind)) throw new LookupError('Unknown action.');
  const r = await getJson<{ results: { url: string; anime_name?: string }[] }>(`https://nekos.best/api/v2/${kind}`, { timeoutMs: 10_000 });
  const g = r.results?.[0];
  if (!g?.url || !/^https:\/\/nekos\.best\//.test(g.url)) throw new LookupError('The GIF service returned nothing. Try again.');
  return { url: g.url, anime: g.anime_name };
}

// ─── Tweets (vxtwitter) ──────────────────────────────────────────────────────

export function parseTweetUrl(input: string): { user: string; id: string } {
  const m = /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:twitter|x|fxtwitter|vxtwitter|fixupx)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{1,25})/i.exec(input.trim());
  if (!m) throw new LookupError('Send a tweet link like `https://x.com/user/status/123…`.');
  return { user: m[1]!, id: m[2]! };
}

export interface Tweet { user: string; handle: string; avatar?: string; text: string; likes: number; retweets: number; replies: number; date: string; url: string; media: { type: string; url: string }[]; sensitive: boolean }
interface TweetRaw { user_name: string; user_screen_name: string; user_profile_image_url?: string; text: string; likes: number; retweets: number; replies: number; date: string; tweetURL: string; possibly_sensitive?: boolean; media_extended?: { type: string; url: string }[] }

export const parseTweet = (r: TweetRaw): Tweet => ({
  user: r.user_name, handle: r.user_screen_name, avatar: r.user_profile_image_url, text: r.text, likes: r.likes, retweets: r.retweets, replies: r.replies, date: r.date, url: r.tweetURL,
  media: (r.media_extended ?? []).filter(m => /^https:\/\//.test(m.url)).map(m => ({ type: m.type, url: m.url })), sensitive: !!r.possibly_sensitive,
});

export async function tweet(link: string): Promise<Tweet> {
  const { user, id } = parseTweetUrl(link);
  const r = await getJson<TweetRaw>(`https://api.vxtwitter.com/${user}/status/${id}`, { cacheMs: 5 * 60_000 });
  if (!r?.text && !r?.media_extended?.length) throw new LookupError('I couldn\'t read that post (it may be deleted or private).');
  return parseTweet(r);
}
