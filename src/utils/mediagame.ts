import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Client, Colors, EmbedBuilder, escapeMarkdown, type SendableChannels } from 'discord.js';
import * as db from './db.js';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG_BASE  = 'https://image.tmdb.org/t/p/w1280';
const HINT_COLOR = 0xFFD700; // gold — matches the 💡 style
const MSDB_BASE = 'https://www.moviestillsdb.com';
const MSDB_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};
const RAWG_BASE = 'https://api.rawg.io/api';
const DEEZER_BASE = 'https://api.deezer.com';

export type MediaType = 'movie' | 'tv' | 'game' | 'music';

export function typeNoun(type: MediaType): string {
  return type === 'movie' ? 'movie' : type === 'tv' ? 'TV show' : type === 'game' ? 'video game' : 'song';
}

export interface MediaEntry {
  id: number;
  type: MediaType;
  title: string;
  year: number | null;
  genre: string | null;
  // movie: director · tv: creator · game: developer(s) · music: artist name
  director: string | null;
  // movie/tv: cast · game: platforms · music: album title
  cast: string | null;
  synopsis: string | null;
  // movie/tv: tagline (unused for hints) · music: formatted duration (e.g. "3:24"), shown in the info-card hint
  tagline: string | null;
  // movie/tv/game: screenshots, revealed as the round image / "another scene" hint
  // music: single-element array holding the album art, revealed only as the late "album art" hint — never shown upfront
  stills: string[];
  // music only: direct URL to a 30-second preview clip, downloaded and re-posted as a native
  // Discord attachment at round start (not linked directly — CDN URLs can expire/unfurl unreliably)
  audioPreview?: string;
}

export interface GameState {
  /** null for a solo round in someone's DMs with the bot: skipping is instant, hints have no cooldown and no XP is at stake. */
  guildId: string | null;
  channelId: string;
  type: MediaType;
  media: MediaEntry;
  hintOrder: number[]; // shuffled indices into HINT_TYPES, randomised per round — same order for everyone, kept fair
  hintsUsed: number; // shared — one hint sequence for the whole room, posted publicly
  lastHintAt: number; // shared cooldown timestamp, skippable with the Hint Rush boost
  voteskips: Set<string>;
  messageId: string | null;
  startedAt: number;
  answered: boolean;
  /**
   * Set for a round run entirely through interactions — in a group DM, or anywhere the bot can neither read nor post in the channel.
   * Guesses come from a pop-up box, the round message is edited through the command's own webhook, and it ends by itself before
   * that webhook's 15 minutes run out.
   */
  interactive?: { ownerId: string; edit: (payload: RoundEdit) => Promise<unknown>; timer: ReturnType<typeof setTimeout> };
}

/** How a finished interactive round rewrites its message. */
export interface RoundEdit {
  content?: string;
  embeds?: EmbedBuilder[];
  files?: AttachmentBuilder[];
  attachments?: never[];
  components?: ActionRowBuilder<ButtonBuilder>[];
}

export const activeGames = new Map<string, GameState>();
/** Channels whose next round is being fetched/posted right now, so a double click can't post two rounds. */
const starting = new Set<string>();
/** A round is live in the channel, or one is on its way. */
export const roundBusy = (channelId: string) => activeGames.has(channelId) || starting.has(channelId);

// /voteskip is locked out for the first 5 minutes of a round — gives people
// a fair shot before the round can be cut short.
export const VOTESKIP_DELAY_MS = 5 * 60_000;
export const VOTES_NEEDED = 2;

// channelId -> pending "skip now available" announcement timer, so it can be
// cancelled if the round resolves (correct guess, admin skip, stop) before
// the delay elapses.
const skipTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** The channel to post the round in — fetched (not just read from cache) so DM channels work after a restart. */
async function sendable(client: Client, channelId: string): Promise<SendableChannels | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  return channel?.isSendable() ? channel : null;
}

/** Custom id of the "Next round" button posted after a DM round ends. */
export const NEXT_ROUND_PREFIX = 'mg_next:';
export const nextRoundButton = (type: MediaType) => new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder().setCustomId(`${NEXT_ROUND_PREFIX}${type}`).setLabel('Next round').setEmoji('▶️').setStyle(ButtonStyle.Primary),
);

export function cancelSkipTimer(channelId: string): void {
  const t = skipTimers.get(channelId);
  if (t) { clearTimeout(t); skipTimers.delete(channelId); }
}

// Schedules the "Vote Skip Available" announcement for whenever the delay
// actually elapses relative to when the round STARTED — safe to call again
// after a restart (restoreActiveGames) since it's based on state.startedAt,
// not "now".
function scheduleSkipAnnouncement(state: GameState, client: Client): void {
  cancelSkipTimer(state.channelId);
  if (!state.guildId) return; // DM rounds can be skipped straight away
  const remaining = VOTESKIP_DELAY_MS - (Date.now() - state.startedAt);
  if (remaining <= 0) return; // already past the delay — /community voteskip works immediately, no announcement needed
  const timer = setTimeout(async () => {
    skipTimers.delete(state.channelId);
    if (activeGames.get(state.channelId) !== state || state.answered) return;
    const channel = await sendable(client, state.channelId);
    if (!channel) return;
    const embed = new EmbedBuilder()
      .setColor(HINT_COLOR)
      .setTitle('⏰ Vote Skip Available')
      .setDescription(`The skip delay has elapsed! Anyone can now vote to skip this ${typeNoun(state.type)} using \`/community voteskip\` *(2 votes needed)*.`);
    await channel.send({ embeds: [embed] }).catch(() => {});
  }, remaining);
  skipTimers.set(state.channelId, timer);
}

// Fire-and-forget persistence so a restart resumes the round instead of
// discarding it — never awaited on the hot path, a missed write just means
// the round falls back to a fresh start on the next restart.
function persistRound(state: GameState): void {
  if (state.interactive) return; // its interaction can't outlive a restart, so there is nothing to resume
  db.saveMediaGuessRound({
    channel_id: state.channelId,
    guild_id: state.guildId ?? '', // '' marks a DM round (the column is NOT NULL)
    type: state.type,
    media: JSON.stringify(state.media),
    hint_order: JSON.stringify(state.hintOrder),
    hints_used: state.hintsUsed,
    message_id: state.messageId,
    started_at: state.startedAt,
    last_hint_at: state.lastHintAt,
    user_hints: '{}', // vestigial column, kept for schema compat — hints are shared now, not per-user
  }).catch(() => {});
}

// Called once at startup, before any startGame() calls, so in-progress rounds
// are resumed in place rather than replaced with a brand-new round.
export async function restoreActiveGames(client: Client): Promise<void> {
  const rows = await db.getAllMediaGuessRounds().catch(() => []);
  for (const row of rows) {
    try {
      const state: GameState = {
        guildId: row.guild_id || null,
        channelId: row.channel_id,
        type: row.type as MediaType,
        media: JSON.parse(row.media),
        hintOrder: JSON.parse(row.hint_order),
        hintsUsed: row.hints_used,
        lastHintAt: row.last_hint_at,
        voteskips: new Set(),
        messageId: row.message_id,
        startedAt: row.started_at,
        answered: false,
      };
      activeGames.set(row.channel_id, state);
      scheduleSkipAnnouncement(state, client);
    } catch {
      // Malformed row (e.g. old schema) — drop it rather than block the rest.
      await db.deleteMediaGuessRound(row.channel_id).catch(() => {});
    }
  }
  if (rows.length) console.log(`[mediaguess] Resumed ${activeGames.size} in-progress round(s) after restart`);
}

// ─── MovieStillsDB client ─────────────────────────────────────────────────────
// Preferred image source: genuine publicity/production stills with no title
// overlay. Uses MSDB's real JSON API (the old /search?q= page is dead and just
// redirects to a browse page). Falls back to TMDB backdrops if anything fails.
//
// Flow: GET / (session cookie + CSRF token) → /api/search?query= →
//       movie page (window.titleId) → /api/pictures?t=<titleId>

function abortAfter(ms: number): { signal: AbortSignal; clear: () => void } {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(id) };
}

interface MsdbSession { cookie: string; csrf: string; fetchedAt: number; }
let msdbSession: MsdbSession | null = null;
const MSDB_SESSION_TTL = 10 * 60 * 1000; // refresh the token/cookie every 10 min

async function getMsdbSession(force = false): Promise<MsdbSession | null> {
  if (!force && msdbSession && Date.now() - msdbSession.fetchedAt < MSDB_SESSION_TTL) {
    return msdbSession;
  }
  try {
    const t = abortAfter(6000);
    const res = await fetch(`${MSDB_BASE}/`, { headers: MSDB_HEADERS, signal: t.signal });
    t.clear();
    if (!res.ok) return null;
    const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const html = await res.text();
    const m = html.match(/<meta name="csrf-token" content="([^"]+)"/i);
    if (!m || !cookie) return null;
    msdbSession = { cookie, csrf: m[1]!, fetchedAt: Date.now() };
    return msdbSession;
  } catch {
    return null;
  }
}

// Call an MSDB JSON API endpoint with the session cookie + CSRF token.
// Retries once with a fresh session if the token has gone stale (403/419).
async function msdbApi(path: string): Promise<any | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const sess = await getMsdbSession(attempt > 0);
    if (!sess) return null;
    try {
      const t = abortAfter(6000);
      const res = await fetch(`${MSDB_BASE}${path}`, {
        headers: {
          ...MSDB_HEADERS,
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRF-TOKEN': sess.csrf,
          'Cookie': sess.cookie,
        },
        signal: t.signal,
      });
      t.clear();
      if (res.status === 419 || res.status === 403) { msdbSession = null; continue; }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }
  return null;
}

async function fetchMovieStillsDB(title: string, year: number | null): Promise<string[]> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  try {
    // 1. Search — the API matches "Title Year" and returns [{ url, name }].
    const query = encodeURIComponent(year ? `${title} ${year}` : title);
    const results = await msdbApi(`/api/search?query=${query}`);
    if (!Array.isArray(results) || !results.length) return [];

    // 2. Pick the entry whose name actually matches the title (ignore the
    //    "(YEAR)" suffix MSDB appends). Fall back to the first result only if
    //    nothing matches exactly — better a near-match than the wrong movie.
    const want = norm(title);
    const stripYear = (n: string) => n.replace(/\s*\(\d{4}\)\s*$/, '');
    const match =
      results.find((r: any) => norm(stripYear(String(r.name ?? ''))) === want
        && (!year || String(r.name ?? '').includes(String(year))))
      ?? results.find((r: any) => norm(stripYear(String(r.name ?? ''))) === want)
      ?? results[0];
    const movieUrl: string | undefined = match?.url;
    if (!movieUrl) return [];

    // 3. The pictures API needs the internal numeric titleId, which only lives
    //    on the movie page as `window.titleId` (not the id in the URL slug).
    const t = abortAfter(6000);
    const pageRes = await fetch(`${MSDB_BASE}${movieUrl}`, { headers: MSDB_HEADERS, signal: t.signal });
    t.clear();
    if (!pageRes.ok) return [];
    const pageHtml = await pageRes.text();
    const idM = pageHtml.match(/window\.titleId\s*=\s*['"](\d+)['"]/);
    if (!idM) return [];

    // 4. Fetch the stills for this title.
    const pics = await msdbApi(`/api/pictures?page=1&t=${idM[1]}`);
    const data = pics?.data;
    if (!Array.isArray(data) || !data.length) return [];

    // 5. Keep only landscape scene stills (ratio > 1.2 — skips portrait posters
    //    and character art), avoid the "poster" category, and use the 500px
    //    preview image. These are clean stills with no title text overlay.
    //    Capture each still's scene description so we can diversify the picks.
    const candidates = data
      .filter((p: any) => (p.ratio ?? 0) > 1.2)
      .filter((p: any) => !/poster/i.test(String(p?.category?.name ?? '')))
      .map((p: any) => ({
        url: p?.preview?.path as string,
        desc: String(p?.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase(),
      }))
      .filter((c: { url: string }) => typeof c.url === 'string' && c.url.startsWith('http'));

    if (!candidates.length) {
      console.log(`[mediaguess] MSDB: no usable stills for "${title}", falling back to TMDB`);
      return [];
    }

    // Shuffle so each round doesn't always open on the same frame.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
    }

    // Greedily reorder so each still differs in scene description from the one
    // before it. This keeps the main image and the "another scene" hint from
    // being near-identical burst shots of the same moment.
    const ordered: typeof candidates = [];
    const pool = [...candidates];
    let lastDesc: string | null = null;
    while (pool.length) {
      let idx = pool.findIndex(c => c.desc !== lastDesc || !c.desc);
      if (idx === -1) idx = 0; // all remaining share a description — take any
      const [chosen] = pool.splice(idx, 1);
      ordered.push(chosen!);
      lastDesc = chosen!.desc;
    }

    const stills = ordered.map(c => c.url).slice(0, 8);
    console.log(`[mediaguess] MSDB: ${stills.length} stills for "${title}"`);
    return stills;
  } catch {
    return [];
  }
}

// ─── Recent-history tracker (prevents repeats for 6 hours per channel) ────────

const RECENT_TTL_MS = 6 * 60 * 60 * 1000;

// channelId -> array of { id, shownAt }
const recentlyShown = new Map<string, { id: number; shownAt: number }[]>();

function getExcludeIds(channelId: string): Set<number> {
  const cutoff = Date.now() - RECENT_TTL_MS;
  const pruned = (recentlyShown.get(channelId) ?? []).filter(e => e.shownAt > cutoff);
  recentlyShown.set(channelId, pruned);
  return new Set(pruned.map(e => e.id));
}

function recordShown(channelId: string, id: number): void {
  const list = recentlyShown.get(channelId) ?? [];
  list.push({ id, shownAt: Date.now() });
  recentlyShown.set(channelId, list);
}

// ─── TMDB API ─────────────────────────────────────────────────────────────────

async function tmdbFetch(path: string): Promise<any> {
  const key = Bun.env.TMDB_API_KEY;
  if (!key) throw new Error('TMDB_API_KEY is not set');
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${TMDB_BASE}${path}${sep}api_key=${key}`);
  if (!res.ok) throw new Error(`TMDB ${res.status} ${path}`);
  return res.json();
}

// Dispatches to the right content source per type — TMDB for movie/tv (existing),
// RAWG for video games, Deezer for music.
async function fetchEntry(type: MediaType, excludeIds: Set<number>): Promise<MediaEntry | null> {
  if (type === 'game') return fetchGameEntry(excludeIds);
  if (type === 'music') return fetchMusicEntry(excludeIds);
  return fetchMovieTvEntry(type, excludeIds);
}

async function fetchMovieTvEntry(type: 'movie' | 'tv', excludeIds: Set<number>): Promise<MediaEntry | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const page = Math.floor(Math.random() * 100) + 1;
      const listPath = type === 'movie'
        ? `/movie/popular?page=${page}&region=US`
        : `/tv/popular?page=${page}&region=US`;
      const list = await tmdbFetch(listPath);

      const results = ((list.results ?? []) as { id: number }[]).filter(r => !excludeIds.has(r.id));
      if (!results.length) continue;

      // Shuffle and try several titles from this page so one filtered-out pick
      // (wrong country, too old, no stills) doesn't waste the whole attempt.
      for (let i = results.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [results[i], results[j]] = [results[j]!, results[i]!];
      }

      for (const pick of results.slice(0, 8)) {
        const detailPath =
          type === 'movie'
            ? `/movie/${pick.id}?append_to_response=images,credits&include_image_language=null`
            : `/tv/${pick.id}?append_to_response=images,credits&include_image_language=null`;

        const d = await tmdbFetch(detailPath);

        // Only accept American productions
        if (type === 'movie') {
          const countries = (d.production_countries as { iso_3166_1: string }[] | undefined) ?? [];
          if (!countries.some(c => c.iso_3166_1 === 'US')) continue;
        } else {
          const origins = (d.origin_country as string[] | undefined) ?? [];
          if (!origins.includes('US')) continue;
        }

        const title: string = type === 'movie' ? (d.title ?? '') : (d.name ?? '');
        if (!title) continue;

        const rawDate: string | undefined = type === 'movie' ? d.release_date : d.first_air_date;
        const year: number | null = rawDate ? parseInt(rawDate.slice(0, 4)) : null;

        // Only feature titles from 1975 to the present day. Skip anything older or undated.
        if (year === null || year < 1975) continue;

        // Try MovieStillsDB first — genuine production stills with no title overlay.
        // Fall back to TMDB iso_639_1=null backdrops if MSDB comes up empty.
        let stills = await fetchMovieStillsDB(title, year);
        if (!stills.length) {
          stills = (
            (d.images?.backdrops ?? []) as { file_path: string; vote_average: number; iso_639_1: string | null }[]
          )
            .filter(b => b.iso_639_1 === null)
            .sort((a, b) => b.vote_average - a.vote_average)
            .slice(0, 5)
            .map(b => `${IMG_BASE}${b.file_path}`);
        }
        if (!stills.length) continue;

        const genres = (d.genres as { name: string }[] | undefined) ?? [];
        const genre: string | null = genres.length ? genres.map(g => g.name).join(', ') : null;

        let director: string | null = null;
        if (type === 'movie') {
          const crew = (d.credits?.crew as { job: string; name: string }[] | undefined) ?? [];
          director = crew.find(c => c.job === 'Director')?.name ?? null;
        } else {
          const creators = (d.created_by as { name: string }[] | undefined) ?? [];
          director = creators[0]?.name ?? null;
        }

        const castArr = (d.credits?.cast as { name: string }[] | undefined) ?? [];
        const cast: string | null = castArr.length
          ? castArr.slice(0, 4).map(c => c.name).join(', ')
          : null;

        const tagline: string | null = (d.tagline as string | undefined) || null;

        return {
          id: pick.id,
          type,
          title,
          year,
          genre,
          director,
          cast,
          synopsis: (d.overview as string | undefined) ?? null,
          tagline,
          stills,
        };
      }
    } catch (err) {
      console.error(`[mediaguess] TMDB fetch error (attempt ${attempt + 1}):`, err);
    }
  }
  return null;
}

// ─── RAWG API (video games) ────────────────────────────────────────────────────
// Free tier, single API key (like TMDB) — no OAuth dance. Docs: https://rawg.io/apidocs

async function rawgFetch(path: string): Promise<any> {
  const key = Bun.env.RAWG_API_KEY;
  if (!key) throw new Error('RAWG_API_KEY is not set');
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${RAWG_BASE}${path}${sep}key=${key}`);
  if (!res.ok) throw new Error(`RAWG ${res.status} ${path}`);
  return res.json();
}

async function fetchGameEntry(excludeIds: Set<number>): Promise<MediaEntry | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const page = Math.floor(Math.random() * 40) + 1;
      // Popular, well-reviewed games only — an obscure 40-download indie title
      // isn't a fair guess. metacritic>=60 plus sort-by-added (popularity proxy).
      const list = await rawgFetch(`/games?page=${page}&page_size=40&ordering=-added&metacritic=60,100&dates=1990-01-01,2100-01-01`);

      const results = ((list.results ?? []) as { id: number }[]).filter(r => !excludeIds.has(r.id));
      if (!results.length) continue;

      for (let i = results.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [results[i], results[j]] = [results[j]!, results[i]!];
      }

      for (const pick of results.slice(0, 8)) {
        const d = await rawgFetch(`/games/${pick.id}`);

        const title: string = d.name ?? '';
        if (!title) continue;

        const year: number | null = d.released ? parseInt(String(d.released).slice(0, 4)) : null;
        if (year === null || year < 1990) continue;

        // The /games/{id} detail response doesn't actually include screenshots
        // (verified live — short_screenshots isn't present there despite some
        // docs implying it is), so the dedicated endpoint is the only source.
        const shotsRes = await rawgFetch(`/games/${pick.id}/screenshots`).catch(() => null);
        const shots: string[] = (shotsRes?.results as { image: string }[] | undefined)?.map(s => s.image) ?? [];
        if (d.background_image && !shots.includes(d.background_image)) shots.unshift(d.background_image);
        if (!shots.length) continue;

        const genres = (d.genres as { name: string }[] | undefined) ?? [];
        const genre: string | null = genres.length ? genres.map(g => g.name).join(', ') : null;

        const developers = (d.developers as { name: string }[] | undefined) ?? [];
        const director: string | null = developers.length ? developers.map(x => x.name).join(', ') : null;

        const platforms = (d.platforms as { platform: { name: string } }[] | undefined) ?? [];
        const cast: string | null = platforms.length
          ? platforms.slice(0, 5).map(p => p.platform.name).join(', ')
          : null;

        return {
          id: pick.id,
          type: 'game',
          title,
          year,
          genre,
          director,
          cast,
          synopsis: (d.description_raw as string | undefined)?.trim() || null,
          tagline: null,
          stills: shots.slice(0, 8),
        };
      }
    } catch (err) {
      console.error(`[mediaguess] RAWG fetch error (attempt ${attempt + 1}):`, err);
    }
  }
  return null;
}

// ─── Deezer API (music) ─────────────────────────────────────────────────────────
// Fully public, zero auth needed at all. Charts give curated "currently popular"
// tracks (same anti-obscurity reasoning as TMDB's "popular" endpoint / RAWG's
// metacritic filter) across a rotating set of mainstream genres for variety.

// Deezer genre IDs: 0=All (global chart), then a mainstream rotation. The chart
// endpoint's response has no field naming the genre, so map it locally — verified
// against GET /genre.
const DEEZER_GENRE_NAMES: Record<number, string | null> = {
  0: null, 132: 'Pop', 116: 'Rap/Hip Hop', 152: 'Rock', 113: 'Dance',
  165: 'R&B', 85: 'Alternative', 106: 'Electro', 84: 'Country',
};
// 0 ("All" — the actual current top-100) appears 3x for extra weight vs. each genre chart once.
const DEEZER_GENRES = [0, 0, 0, ...Object.keys(DEEZER_GENRE_NAMES).map(Number).filter(id => id !== 0)];

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

async function fetchMusicEntry(excludeIds: Set<number>): Promise<MediaEntry | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const genreId = DEEZER_GENRES[Math.floor(Math.random() * DEEZER_GENRES.length)];
      const res = await fetch(`${DEEZER_BASE}/chart/${genreId}/tracks?limit=50`);
      if (!res.ok) throw new Error(`Deezer ${res.status}`);
      const list = await res.json() as any;

      const results = ((list.data ?? []) as { id: number }[]).filter(r => !excludeIds.has(r.id));
      if (!results.length) continue;

      for (let i = results.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [results[i], results[j]] = [results[j]!, results[i]!];
      }

      for (const pick of results.slice(0, 8) as any[]) {
        const title: string = pick.title_short || pick.title || '';
        if (!title || !pick.preview) continue;

        const albumArt: string | null = pick.album?.cover_xl ?? pick.album?.cover_big ?? null;
        if (!albumArt) continue;

        return {
          id: pick.id,
          type: 'music',
          title,
          year: null, // Deezer's chart/track objects don't include a release date without an extra album lookup
          genre: DEEZER_GENRE_NAMES[genreId] ?? null,
          director: pick.artist?.name ?? null, // artist
          cast: pick.album?.title ?? null,     // album
          synopsis: null,
          tagline: pick.duration ? fmtDuration(pick.duration) : null,
          stills: [albumArt],
          audioPreview: pick.preview,
        };
      }
    } catch (err) {
      console.error(`[mediaguess] Deezer fetch error (attempt ${attempt + 1}):`, err);
    }
  }
  return null;
}

// ─── Fuzzy matching ───────────────────────────────────────────────────────────

// Longest-to-shortest so e.g. VIII is replaced before VII before VI before I
const ROMAN_TO_ARABIC: [RegExp, string][] = [
  [/\bXVIII\b/gi, '18'], [/\bXVII\b/gi, '17'], [/\bXVI\b/gi, '16'],
  [/\bXV\b/gi, '15'],    [/\bXIV\b/gi, '14'],  [/\bXIII\b/gi, '13'],
  [/\bXII\b/gi, '12'],   [/\bXI\b/gi, '11'],   [/\bXX\b/gi, '20'],
  [/\bX\b/gi, '10'],     [/\bIX\b/gi, '9'],    [/\bVIII\b/gi, '8'],
  [/\bVII\b/gi, '7'],    [/\bVI\b/gi, '6'],    [/\bIV\b/gi, '4'],
  [/\bV\b/gi, '5'],      [/\bIII\b/gi, '3'],   [/\bII\b/gi, '2'],
  [/\bI\b/gi, '1'],
];

const WORD_TO_ARABIC: [RegExp, string][] = [
  [/\btwenty\b/gi, '20'],   [/\bnineteen\b/gi, '19'], [/\beighteen\b/gi, '18'],
  [/\bseventeen\b/gi, '17'], [/\bsixteen\b/gi, '16'], [/\bfifteen\b/gi, '15'],
  [/\bfourteen\b/gi, '14'], [/\bthirteen\b/gi, '13'], [/\btwelve\b/gi, '12'],
  [/\beleven\b/gi, '11'],   [/\bten\b/gi, '10'],      [/\bnine\b/gi, '9'],
  [/\beight\b/gi, '8'],     [/\bseven\b/gi, '7'],     [/\bsix\b/gi, '6'],
  [/\bfive\b/gi, '5'],      [/\bfour\b/gi, '4'],      [/\bthree\b/gi, '3'],
  [/\btwo\b/gi, '2'],       [/\bone\b/gi, '1'],
];

function normalizeNumbers(s: string): string {
  for (const [re, digit] of ROMAN_TO_ARABIC) s = s.replace(re, digit);
  for (const [re, digit] of WORD_TO_ARABIC)  s = s.replace(re, digit);
  return s;
}

function levenshtein(a: string, b: string): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(dp[j]!, dp[j - 1]!, prev);
      prev = temp;
    }
  }
  return dp[b.length]!;
}

function normalize(s: string): string {
  // Strip punctuation BEFORE converting numerals so initialisms like "M.I.A."
  // become "mia" (the standalone "I" is no longer a word on its own and isn't
  // turned into "1"). Space-delimited numerals like "Rocky V" still convert.
  const cleaned = s
    .toLowerCase()
    .replace(/[-–—]/g, ' ')   // hyphens/dashes → space so "Ant-Man" = "ant man"
    .replace(/&/g, ' and ')   // unify "&" with the word "and" before punctuation is stripped
    .replace(/[^\w\s]/g, '')
    // drop filler connectors/articles anywhere so "Lilo & Stitch" = "lilo stitch"
    // and "Star Wars: A New Hope" = "star wars new hope"
    .replace(/\b(?:and|the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalizeNumbers(cleaned)
    .replace(/\s+/g, ' ')
    .trim();
}

export type MatchResult = 'correct' | 'very_close' | 'close' | 'wrong';

// Studio possessive prefixes that people drop when guessing — "Marvel's Daredevil"
// is universally known as just "Daredevil".
const BRAND_PREFIXES = new Set(['marvel', 'dc', 'disney', 'pixar', 'dreamworks', 'hbo', 'netflix']);

// For series titles like "Star Wars: Episode IV - A New Hope" produce the answers
// a player would reasonably give: the subtitle alone ("new hope"), franchise + subtitle
// ("star wars new hope"), and franchise + episode number ("star wars 4"). Crucially it
// does NOT add the franchise alone ("star wars") — that's ambiguous across the series.
function seriesCandidates(title: string): string[] {
  // Split only on real separators: a colon, or a dash surrounded by spaces.
  // (Won't split hyphenated words like "Spider-Man".)
  const segs = title.split(/\s*:\s*|\s+[-–—]\s+/).map(s => s.trim()).filter(Boolean);
  if (segs.length < 2) return [];

  const main = normalize(segs[0]!);
  if (!main) return [];

  let episodeNum: string | null = null;
  let subtitle: string | null = null;
  for (const seg of segs.slice(1)) {
    const n = normalize(seg);
    if (!n) continue;
    const ep = n.match(/^(?:episode|part|chapter|book|vol|volume)\s+(\d+)$/);
    if (ep) episodeNum = ep[1]!;       // "Episode IV" → "4"
    else subtitle = n;                 // last non-designator segment is the subtitle
  }

  const out: string[] = [];
  if (subtitle) {
    out.push(`${main} ${subtitle}`);                              // "star wars new hope"
    if (subtitle.split(' ').length >= 2) out.push(subtitle);     // "new hope" (only if distinctive)
  }
  if (episodeNum) {
    out.push(`${main} ${episodeNum}`);                           // "star wars 4"
    if (subtitle) out.push(`${main} ${episodeNum} ${subtitle}`); // "star wars 4 new hope"
  }
  return out;
}

// Produce the set of acceptable normalized titles for matching.
function titleCandidates(title: string): string[] {
  const cands = new Set<string>();
  cands.add(normalize(title));
  // "Marvel's Daredevil" → also accept "Daredevil"
  const m = title.match(/^([\w.]+)'s\s+(.+)$/i);
  if (m && BRAND_PREFIXES.has(m[1]!.toLowerCase())) cands.add(normalize(m[2]!));
  for (const c of seriesCandidates(title)) cands.add(c);
  return [...cands].filter(c => c.length >= 2);
}

export function checkGuess(guess: string, title: string): MatchResult {
  const ng = normalize(guess);
  if (ng.length < 2) return 'wrong';
  const ngNoSpace = ng.replace(/ /g, '');

  const RANK = { wrong: 0, close: 1, very_close: 2, correct: 3 } as const;
  let best: MatchResult = 'wrong';

  for (const nt of titleCandidates(title)) {
    let r: MatchResult = 'wrong';

    // Exact, or equal once spaces are ignored: "dare devil" = "daredevil", "spider man" = "spiderman".
    // Acceptable subtitle/episode forms are supplied as explicit candidates (see seriesCandidates),
    // so a bare franchise prefix like "star wars" is NOT a match for "Star Wars: A New Hope".
    if (ng === nt || ngNoSpace === nt.replace(/ /g, '')) {
      r = 'correct';
    } else {
      // Closeness is based on the FRACTION of letters shared, not raw edit
      // distance — a real misspelling keeps most of the title's letters, while
      // a different word of the same length does not. This stops short titles
      // like "Mia" flagging every 3-letter M-word ("moe", "man", …) as close.
      {
        const dist = levenshtein(ng, nt);
        const similarity = 1 - dist / Math.max(ng.length, nt.length);
        if (similarity >= 0.72) {
          r = 'very_close';
        } else if (similarity >= 0.62) {
          r = 'close';
        } else {
          const titleWords = nt.split(' ').filter(w => w.length > 2);
          if (titleWords.length > 1) {
            const guessWords = ng.split(' ');
            const hits = titleWords.filter(tw =>
              guessWords.some(gw => gw === tw || tw.startsWith(gw) || gw.startsWith(tw)),
            ).length;
            if (hits >= Math.ceil(titleWords.length * 0.75)) r = 'close';
          }
        }
      }
    }

    if (RANK[r] > RANK[best]) best = r;
    if (best === 'correct') break;
  }

  return best;
}

// ─── Hint helpers ─────────────────────────────────────────────────────────────

function maskTitle(title: string): string {
  // Reveal first letter of each word, mask the rest with underscores
  let startOfWord = true;
  return [...title].map(ch => {
    if (ch === ' ') { startOfWord = true; return '  '; } // double space for readability
    if (/[a-zA-Z0-9]/.test(ch)) {
      if (startOfWord) { startOfWord = false; return ch.toUpperCase(); }
      return '\\_';
    }
    startOfWord = false;
    return ch; // punctuation stays
  }).join('');
}

function anagramTitle(title: string): string {
  return title.replace(/[a-zA-Z]+/g, word => {
    // Scramble letter positions but keep each letter's original case — only the
    // letters actually capitalised in the title stay uppercase.
    const chars = [...word];
    for (let i = chars.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [chars[i], chars[j]] = [chars[j]!, chars[i]!];
    }
    return chars.join('');
  });
}

function buildHintOrder(media: MediaEntry): number[] {
  // Only include hint types that have usable data for this entry
  const available = [0, 1, 2]; // info, letters, anagram — always possible
  if (media.type === 'music') {
    // Extended snippet + artist reveal + album art are always available for music.
    available.push(3, 4, 5);
  } else {
    if (media.stills.length >= 2) available.push(3); // another scene
    if (media.synopsis)           available.push(4); // description
  }
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j]!, available[i]!];
  }
  return available;
}

// ─── Hint builder ─────────────────────────────────────────────────────────────

// Slots 1 (masked title) and 2 (anagram) are pure string ops shared by every
// type. Slots 0/3/4 mean different things for music, which also gets a 6th
// slot (5) that movie/tv/game never reach — see requestHint().
const HINT_TYPES = [
  'Information',
  'Title Letters',
  'Anagram / Scrambled Letters',
  'Another Scene Clue',
  'Description',
];
const MUSIC_HINT_TYPES = [
  'Information',
  'Title Letters',
  'Anagram / Scrambled Letters',
  'Extended Snippet',
  'Artist Reveal',
  'Album Art',
];

export interface HintPayload {
  content?: string;
  embeds?: EmbedBuilder[];
  files?: AttachmentBuilder[];
}

const HINT_COOLDOWN_MS = 60_000;

// Hints are shared and public — one hint sequence for the whole room, posted
// visibly so everyone benefits from the same reveal. Free of charge, but
// gated by a 60-second cooldown between hints (shared, not per-user) so the
// round can't be trivialized by hint-spam; ⚡ Hint Rush lets its buyer skip
// the cooldown personally. Async because music's "Extended Snippet" hint
// (slot 3) has to re-download and trim audio.
export async function requestHint(channelId: string, userId: string): Promise<HintPayload | null> {
  const state = activeGames.get(channelId);
  if (!state || state.answered) return null;

  const maxHints = state.hintOrder.length;
  if (state.hintsUsed >= maxHints) {
    return { content: `❌ All ${maxHints} hints have been used! Keep guessing or ${state.guildId ? '`/community voteskip`' : 'skip'}.` };
  }

  // The cooldown keeps one person from burning through a shared round; a solo DM round has nobody to spoil it for.
  const elapsed = Date.now() - state.lastHintAt;
  if (state.guildId && state.lastHintAt > 0 && elapsed < HINT_COOLDOWN_MS) {
    const rush = await db.getActiveBoost(state.guildId, userId, 'guesscd').catch(() => null);
    if (!rush) {
      const secsLeft = Math.ceil((HINT_COOLDOWN_MS - elapsed) / 1000);
      return { content: `⏳ Hints are on cooldown — next hint available in **${secsLeft}s**. *(skip with ⚡ Hint Rush from \`/shop\`)*` };
    }
  }

  state.lastHintAt = Date.now();
  state.hintsUsed++;
  persistRound(state);
  const { media, type } = state;
  const n = state.hintsUsed;
  const label = type === 'movie' ? 'Movie' : type === 'tv' ? 'TV Show' : type === 'game' ? 'Game' : 'Song';
  const hintIdx = state.hintOrder[n - 1]!;
  const hintType = (type === 'music' ? MUSIC_HINT_TYPES : HINT_TYPES)[hintIdx]!;

  const embed = new EmbedBuilder()
    .setColor(HINT_COLOR)
    .setTitle(`💡 ${label} Hint #${n} (${hintType})`)
    .setFooter({ text: `Requested by <@${userId}> · ${n}/${maxHints} hints used` });
  let files: AttachmentBuilder[] | undefined;

  switch (hintIdx) {
    case 0: {
      const lines: string[] = [];
      if (type === 'music') {
        // Deliberately no artist name here — that's its own later hint (slot 4).
        if (media.year)    lines.push(`**Release Year:** ${media.year}`);
        if (media.genre)   lines.push(`**Genre:** ${media.genre}`);
        if (media.tagline) lines.push(`**Duration:** ${media.tagline}`);
      } else {
        const directorLabel = type === 'movie' ? 'Director' : type === 'tv' ? 'Creator' : 'Developer';
        if (media.year)     lines.push(`**Release Year:** ${media.year}`);
        if (media.genre)    lines.push(`**Genre(s):** ${media.genre}`);
        if (media.cast)     lines.push(`**${type === 'game' ? 'Platforms' : 'Cast'}:** ${media.cast}`);
        if (media.director) lines.push(`**${directorLabel}:** ${media.director}`);
      }
      embed.setDescription(lines.join('\n') || 'No information available.');
      break;
    }
    case 1: {
      const masked = maskTitle(media.title);
      embed.setDescription(
        `**Masked Title** *(first letter of each word revealed!)*:\n\n${masked}`
      );
      break;
    }
    case 2: {
      const anagram = anagramTitle(media.title);
      embed.setDescription(`**Anagram:** ${anagram}`);
      break;
    }
    case 3: {
      if (type === 'music') {
        // A different, later window than the public round clip — new info,
        // not just "the same intro but longer".
        const full = media.audioPreview ? await downloadPreview(media.audioPreview) : null;
        const clip = full ? await trimAudio(full, EXTENDED_CLIP_START_SEC, EXTENDED_CLIP_DURATION_SEC) : null;
        if (clip) {
          embed.setDescription(`Here's another ${EXTENDED_CLIP_DURATION_SEC}-second snippet, later in the track!`);
          files = [new AttachmentBuilder(clip, { name: 'extended.mp3' })];
        } else {
          embed.setDescription('Could not grab an extended snippet for this one.');
        }
        break;
      }
      const extra = media.stills[1];
      if (extra) {
        const noun = type === 'game' ? 'the game' : type === 'movie' ? 'the movie' : 'the show';
        embed.setDescription(`Here is another scene from ${noun}!`).setImage(extra);
      } else {
        embed.setDescription('No additional scene available for this one.');
      }
      break;
    }
    case 4: {
      if (type === 'music') {
        embed.setDescription(`**Artist:** ${media.director ?? 'Unknown'}`);
        break;
      }
      if (!media.synopsis) {
        embed.setDescription('No description available for this one.');
        break;
      }
      // Redact every occurrence of the title (and any individual word >3 chars from it)
      const escaped = media.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let redacted = media.synopsis.replace(new RegExp(escaped, 'gi'), '**[REDACTED]**');
      // Also redact significant individual title words so partial references are hidden
      for (const word of media.title.split(' ')) {
        if (word.length > 3) {
          const we = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          redacted = redacted.replace(new RegExp(`\\b${we}\\b`, 'gi'), '**[REDACTED]**');
        }
      }
      embed.setDescription(redacted.length > 4000 ? redacted.slice(0, 4000) + '…' : redacted);
      break;
    }
    case 5: {
      // Only reachable for music — movie/tv/game never have a 6th hint.
      const art = media.stills[0];
      if (art) embed.setDescription("Here's the album art!").setImage(art);
      else embed.setDescription('No album art available for this one.');
      break;
    }
  }

  return { embeds: [embed], files };
}

// ─── Game lifecycle ───────────────────────────────────────────────────────────

// customIds are plain (no channel/round id encoded) — the button handler looks
// up activeGames by the channel the interaction fired in, and a channel only
// ever has one active round, so nothing extra needs to survive in the id.
// That also means these buttons keep working indefinitely, including across
// restarts, without any collector/timeout tied to the message.
/** guild = a channel an admin set up (guesses are typed, skips are votes); dm = a solo round in a DM with the bot (guesses are typed); interactive = guesses come from a pop-up box. */
export type RoundMode = 'guild' | 'dm' | 'interactive';

function buildRoundButtons(mode: RoundMode): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (mode === 'interactive') row.addComponents(new ButtonBuilder().setCustomId(GUESS_BUTTON).setLabel('Guess').setEmoji('✏️').setStyle(ButtonStyle.Success));
  return row.addComponents(
    new ButtonBuilder().setCustomId('mg_hint').setLabel('Hint').setEmoji('💡').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('mg_voteskip').setLabel(mode === 'guild' ? 'Vote Skip' : 'Skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
  );
}

/** Custom ids of the interactive round's Guess button and its pop-up box. */
export const GUESS_BUTTON = 'mg_guess';
export const GUESS_MODAL = 'mg_guess_modal';
export const GUESS_INPUT = 'mg_guess_text';
/** Custom id prefix of the "Next round" button under a finished interactive round. */
export const INTERACTIVE_NEXT_PREFIX = 'mg_inext:';
export const interactiveNextButton = (type: MediaType) => new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder().setCustomId(`${INTERACTIVE_NEXT_PREFIX}${type}`).setLabel('Next round').setEmoji('▶️').setStyle(ButtonStyle.Primary),
);
/** An interactive round ends by itself after this long — a minute inside the 15 minutes its reply stays editable. */
export const INTERACTIVE_ROUND_MS = 14 * 60_000;

const TYPE_LABEL: Record<MediaType, string> = {
  movie: '🎬 Movie Guessing Game', tv: '📺 TV Show Guessing Game',
  game: '🎮 Video Game Guessing Game', music: '🎵 Song Guessing Game',
};
const TYPE_COLOR: Record<MediaType, number> = {
  movie: 0xE50914, tv: 0x0099FF, game: 0x57F287, music: 0xFF2D78,
};

// The public round clip is short on purpose — the rest of the song is a hint,
// not a freebie. The "Extended Snippet" hint (music slot 3) reveals a longer,
// different window later in the track, privately, if someone wants it.
const ROUND_CLIP_SEC = 5;
const EXTENDED_CLIP_START_SEC = 10;
const EXTENDED_CLIP_DURATION_SEC = 10;

// Downloaded and re-attached rather than linked directly — the Deezer preview
// URL is signed with an expiry, and re-uploading to Discord's own CDN means the
// audio player in the round message keeps working indefinitely, restart or not.
async function downloadPreview(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

// Trims an MP3 buffer to [startSec, startSec+durationSec) via ffmpeg (already a
// production dependency for the /music voice system). For short trims of a
// longer input, ffmpeg often stops reading stdin before we finish writing —
// that's a normal broken pipe, not a real failure, so it's swallowed here
// rather than surfacing as an unhandled rejection.
async function trimAudio(buffer: Buffer, startSec: number, durationSec: number): Promise<Buffer | null> {
  try {
    const proc = Bun.spawn(
      ['ffmpeg', '-y', '-f', 'mp3', '-i', 'pipe:0', '-ss', String(startSec), '-t', String(durationSec),
        '-acodec', 'libmp3lame', '-ab', '128k', '-f', 'mp3', 'pipe:1'],
      { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' },
    );
    (async () => {
      try {
        proc.stdin.write(buffer);
        await proc.stdin.end();
      } catch {
        // broken pipe — ffmpeg already has what it needs
      }
    })();
    const out = await new Response(proc.stdout).arrayBuffer();
    const code = await proc.exited;
    if (code !== 0 || out.byteLength === 0) return null;
    return Buffer.from(out);
  } catch {
    return null;
  }
}

/**
 * Post a new round in the channel. `guildId` null = a solo round in someone's DMs. Resolves false when nothing could be posted
 * (the pick couldn't be fetched, the clip couldn't be downloaded, or the channel is gone).
 */
export async function startGame(
  guildId: string | null,
  channelId: string,
  type: MediaType,
  client: Client,
): Promise<boolean> {
  if (starting.has(channelId)) return false;
  starting.add(channelId);
  try {
    return await postRound(guildId, channelId, type, client);
  } finally {
    starting.delete(channelId);
  }
}

/** A round's message: the still (or the song clip), how to answer in this mode, and the buttons. Null when a song's clip can't be prepared. */
export interface RoundPayload { embeds: EmbedBuilder[]; files?: AttachmentBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] }

export async function buildRound(type: MediaType, media: MediaEntry, mode: RoundMode): Promise<RoundPayload | null> {
  const typeStr = typeNoun(type);
  const isMusic = type === 'music';
  const what = isMusic ? `${ROUND_CLIP_SEC}-second clip` : 'still';
  const how = mode === 'interactive'
    ? `Press **Guess** to type your answer — anyone here can play!\n` +
      `> 💡 **Hint** — Reveal the next clue\n` +
      `> ⏭️ **Skip** — The person who started the round can give up and see the answer\n` +
      `> ⌛ The round ends by itself after ${INTERACTIVE_ROUND_MS / 60_000} minutes`
    : mode === 'dm'
      ? `Type your answer here, or use the buttons below!\n` +
        `> 💡 **Hint** — Reveal the next clue\n` +
        `> ⏭️ **Skip** — Give up and see the answer`
      : `Type your answer in chat, or use the buttons below!\n` +
        `> 💡 **Hint** / \`/community hint\` — Reveal the next clue for everyone *(shared, 60s cooldown between hints)*\n` +
        `> ⏭️ **Vote Skip** / \`/community voteskip\` — Vote to skip *(2 votes needed, available after 5 min)*`;
  const embed = new EmbedBuilder()
    .setColor(TYPE_COLOR[type])
    .setTitle(TYPE_LABEL[type])
    .setDescription(`**Can you guess the ${typeStr} from this ${what}?**\n\n${how}`)
    .setFooter({ text: `Good luck! ${type === 'music' ? '🎧' : type === 'game' ? '🎮' : '🍿'}` });
  const components = [buildRoundButtons(mode)];

  if (isMusic) {
    // No image upfront for music — the album art is a late hint, not a giveaway.
    // Only the first ROUND_CLIP_SEC seconds are posted publicly — the full clue
    // needs to come from guessing, not from getting the whole song for free.
    // discord.js infers the attachment's audio player from the file extension.
    const full = media.audioPreview ? await downloadPreview(media.audioPreview) : null;
    const buf = full ? await trimAudio(full, 0, ROUND_CLIP_SEC) : null;
    if (!buf) {
      console.warn('[mediaguess] Could not download/trim Deezer preview clip — skipping this pick');
      return null;
    }
    return { embeds: [embed], files: [new AttachmentBuilder(buf, { name: 'preview.mp3' })], components };
  }
  embed.setImage(media.stills[0]!);
  return { embeds: [embed], components };
}

async function postRound(guildId: string | null, channelId: string, type: MediaType, client: Client): Promise<boolean> {
  const media = await fetchEntry(type, getExcludeIds(channelId));
  if (!media) {
    console.warn(`[mediaguess] Could not fetch ${type} — check TMDB_API_KEY/RAWG_API_KEY are set`);
    return false;
  }
  recordShown(channelId, media.id);

  const channel = await sendable(client, channelId);
  if (!channel) return false;

  const payload = await buildRound(type, media, guildId ? 'guild' : 'dm');
  if (!payload) return false;
  const msg = await channel.send(payload).catch(() => null);
  if (!msg) return false;

  const state: GameState = {
    guildId,
    channelId,
    type,
    media,
    hintOrder: buildHintOrder(media),
    hintsUsed: 0,
    lastHintAt: 0,
    voteskips: new Set(),
    messageId: msg.id,
    startedAt: Date.now(),
    answered: false,
  };
  activeGames.set(channelId, state);
  persistRound(state);
  scheduleSkipAnnouncement(state, client);
  return true;
}

export async function resolveGame(
  state: GameState,
  client: Client,
  winner: { id: string; name: string; xpGained?: number } | null,
  reason: 'correct' | 'skip' | 'timeout',
): Promise<void> {
  // Atomic claim — delete first so any concurrent resolveGame call sees undefined and exits.
  if (activeGames.get(state.channelId) !== state) return;
  activeGames.delete(state.channelId);
  db.deleteMediaGuessRound(state.channelId).catch(() => {});
  cancelSkipTimer(state.channelId);
  state.answered = true;
  if (state.interactive) { clearTimeout(state.interactive.timer); await finishInteractive(state, winner, reason); return; }
  const typeStr = typeNoun(state.type);
  const channel = await sendable(client, state.channelId);
  if (!channel) return;
  // Server channels roll straight into the next round; a DM waits for the player to ask for one.
  const dm = !state.guildId;
  const next = dm ? '' : '\n_Next round starting in 10 seconds…_';
  const components = dm ? [nextRoundButton(state.type)] : [];

  // Delete the original round message — keeps the channel clean and means a
  // stale Hint/Vote Skip click can't land on a round that's already over.
  if (state.messageId) {
    const roundMsg = await channel.messages.fetch(state.messageId).catch(() => null);
    if (roundMsg) await roundMsg.delete().catch(() => {});
  }

  if (reason === 'correct' && winner) {
    if (state.type === 'music') {
      // Structured embed for music — Song/Artist/XP fields + album art
      // thumbnail, matching the reference layout, plus the full clip
      // attached as a bonus reveal now that the round's over (the 5-second
      // public clip was only ever a snippet).
      const xpLine = winner.xpGained
        ? `+${winner.xpGained} XP`
        : '+0 XP *(Daily XP cap reached)*';
      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle('🎉 Correct Guess!')
        .setDescription(dm ? '🏆 You guessed the song title!' : `🏆 **${winner.name}** guessed the song title!`)
        .addFields(
          { name: 'Song', value: state.media.title, inline: false },
          { name: 'Artist', value: state.media.director ?? 'Unknown', inline: false },
          ...(dm ? [] : [{ name: 'XP Awarded', value: xpLine, inline: false }]),
        );
      if (!dm) embed.setFooter({ text: '🎵 Next song will start in 10 seconds…' });
      if (state.media.stills[0]) embed.setThumbnail(state.media.stills[0]);

      const full = state.media.audioPreview ? await downloadPreview(state.media.audioPreview) : null;
      const files = full ? [new AttachmentBuilder(full, { name: 'full.mp3' })] : [];
      await channel.send({ embeds: [embed], files, components }).catch(() => {});
    } else {
      // Show the display name as plain text (not a <@id> mention) so it reads
      // correctly in mobile push notifications, which don't resolve raw mentions.
      await channel
        .send({ content: `🎉 ${dm ? 'You got it' : `**${winner.name}** got it`}! The ${typeStr} was **${state.media.title}**!${next}`, components })
        .catch(() => {});
    }
  } else {
    await channel
      .send({ content: `⏭️ Skipped! The ${typeStr} was **${state.media.title}**.${next}`, components })
      .catch(() => {});
  }

  if (dm) return;
  setTimeout(async () => {
    // Only start if nothing else has already claimed this channel
    if (!activeGames.has(state.channelId)) {
      await startGame(state.guildId, state.channelId, state.type, client);
    }
  }, 10000);
}

// Shared by /voteskip and the "⏭️ Vote Skip" button so both go through
// identical logic (delay gate, duplicate-vote check, threshold resolve).
export async function castVoteSkip(
  channelId: string, userId: string, client: Client,
): Promise<{ content: string; ephemeral: boolean }> {
  const state = activeGames.get(channelId);
  if (!state || state.answered) {
    return { content: '❌ There is no active guessing game in this channel.', ephemeral: true };
  }

  // Solo DM round: no vote and no wait — skipping just reveals the answer.
  if (!state.guildId) {
    state.answered = true;
    await resolveGame(state, client, null, 'skip');
    return { content: '⏭️ Round skipped.', ephemeral: true };
  }

  const remainingDelay = VOTESKIP_DELAY_MS - (Date.now() - state.startedAt);
  if (remainingDelay > 0) {
    const mins = Math.ceil(remainingDelay / 60_000);
    return { content: `⏳ Vote skip isn't available yet — everyone gets a fair shot first. Try again in **${mins} minute${mins !== 1 ? 's' : ''}**.`, ephemeral: true };
  }

  if (state.voteskips.has(userId)) {
    return { content: '❌ You have already voted to skip this round.', ephemeral: true };
  }

  state.voteskips.add(userId);
  const votes = state.voteskips.size;

  if (votes >= VOTES_NEEDED) {
    state.answered = true; // lock before any await to prevent race with correct guess
    await resolveGame(state, client, null, 'skip');
    return { content: `⏭️ **${votes}/${VOTES_NEEDED}** skip votes — skipping this round!`, ephemeral: false };
  }
  const remaining = VOTES_NEEDED - votes;
  return { content: `🗳️ Skip vote recorded: **${votes}/${VOTES_NEEDED}**. Need **${remaining}** more vote${remaining !== 1 ? 's' : ''} to skip.`, ephemeral: false };
}

// ─── Interactive rounds ───────────────────────────────────────────────────────
// For anywhere the bot can't read or post in the channel (a group DM, a server it isn't in): the round is the command's own reply,
// guesses come from a pop-up box, and everything after that is an edit through the same interaction's webhook.

/** Test hooks: swap how a round's pick is fetched, or how long an interactive round lasts. */
export const hooks: { fetchEntry?: typeof fetchEntry; roundMs?: number } = {};

export interface InteractiveHost {
  client: Client;
  channelId: string;
  /** Who started the round — the only person who can skip it. */
  userId: string;
  /** Posts the round's message and resolves with its id (null if it couldn't be posted). */
  send: (payload: RoundPayload) => Promise<{ id: string } | null>;
  /** Edits that message later, through the same interaction's webhook. */
  edit: (messageId: string, payload: RoundEdit) => Promise<unknown>;
}

/** Starts an interactive round. Resolves false when nothing could be posted, or a round is already going in the channel. */
export async function startInteractiveRound(host: InteractiveHost, type: MediaType): Promise<boolean> {
  const { channelId } = host;
  if (starting.has(channelId) || activeGames.has(channelId)) return false;
  starting.add(channelId);
  try {
    const media = await (hooks.fetchEntry ?? fetchEntry)(type, getExcludeIds(channelId));
    if (!media) {
      console.warn(`[mediaguess] Could not fetch ${type} — check TMDB_API_KEY/RAWG_API_KEY are set`);
      return false;
    }
    recordShown(channelId, media.id);
    const payload = await buildRound(type, media, 'interactive');
    if (!payload) return false;
    const msg = await host.send(payload).catch(() => null);
    if (!msg) return false;
    const state: GameState = {
      guildId: null, channelId, type, media, hintOrder: buildHintOrder(media), hintsUsed: 0, lastHintAt: 0, voteskips: new Set(),
      messageId: msg.id, startedAt: Date.now(), answered: false,
      interactive: {
        ownerId: host.userId,
        edit: p => host.edit(msg.id, p),
        timer: setTimeout(() => {
          if (activeGames.get(channelId) !== state || state.answered) return;
          state.answered = true;
          void resolveGame(state, host.client, null, 'timeout').catch(() => {});
        }, hooks.roundMs ?? INTERACTIVE_ROUND_MS),
      },
    };
    state.interactive!.timer.unref?.(); // never keep the process alive just for a round
    activeGames.set(channelId, state);
    return true;
  } finally {
    starting.delete(channelId);
  }
}

/** A display name that is safe inside the bot's message: no formatting, no masked links, no mentions or pings. */
export function safeName(name: string): string {
  return escapeMarkdown(name.replace(/[<>]/g, ''), { maskedLink: true }).replace(/@/g, `@${String.fromCharCode(0x200b)}`).slice(0, 40);
}

/** Rewrites the round's message with the answer (and a Next round button). */
async function finishInteractive(state: GameState, winner: { id: string; name: string } | null, reason: 'correct' | 'skip' | 'timeout'): Promise<void> {
  const { media, type } = state;
  const lead = reason === 'correct' && winner ? `🎉 **${safeName(winner.name)}** got it!` : reason === 'timeout' ? '⌛ Time\'s up!' : '⏭️ Skipped!';
  const components = [interactiveNextButton(type)];
  let edit: RoundEdit;
  if (type === 'music') {
    const embed = new EmbedBuilder()
      .setColor(reason === 'correct' ? Colors.Green : Colors.Greyple)
      .setTitle(reason === 'correct' ? '🎉 Correct Guess!' : 'The answer')
      .addFields({ name: 'Song', value: media.title, inline: false }, { name: 'Artist', value: media.director ?? 'Unknown', inline: false });
    if (media.stills[0]) embed.setThumbnail(media.stills[0]);
    // The 5-second clip was only ever a snippet: the whole preview is the reveal.
    const full = media.audioPreview ? await downloadPreview(media.audioPreview) : null;
    edit = { content: lead, embeds: [embed], files: full ? [new AttachmentBuilder(full, { name: 'full.mp3' })] : [], attachments: [], components };
  } else {
    edit = { content: `${lead} The ${typeNoun(type)} was **${media.title}**.`, embeds: [], attachments: [], components };
  }
  await state.interactive!.edit(edit).catch(() => {});
}

export type GuessResult = 'no-round' | MatchResult;

/** Checks a typed-in guess against the channel's live round; a correct one ends the round (only the first of several at once can win). */
export async function submitGuess(channelId: string, text: string, who: { id: string; name: string }, client: Client): Promise<GuessResult> {
  const state = activeGames.get(channelId);
  if (!state || state.answered) return 'no-round';
  const result = checkGuess(text.trim(), state.media.title);
  if (result !== 'correct') return result;
  state.answered = true; // lock before any await so two correct guesses can't both win
  await resolveGame(state, client, { id: who.id, name: who.name }, 'correct');
  return 'correct';
}
