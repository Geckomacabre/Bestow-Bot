import { getJson, HttpError } from '../framework/http.js';
import { LookupError } from '../lookups/handler.js';

/**
 * Spotify Web API with app credentials (SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET, free at developer.spotify.com).
 * Spotify stopped giving new apps 30-second previews in late 2024, so previews come from Deezer, matched to the exact recording by ISRC.
 * Without Spotify credentials, search and art fall back to Deezer's keyless API.
 */

export const SPOTIFY_GREEN = 0x1db954;
let token: { value: string; until: number } | null = null;

export const spotifyConfigured = () => !!(Bun.env.SPOTIFY_CLIENT_ID && Bun.env.SPOTIFY_CLIENT_SECRET);

async function appToken(): Promise<string> {
  if (token && token.until > Date.now() + 60_000) return token.value;
  const auth = Buffer.from(`${Bun.env.SPOTIFY_CLIENT_ID}:${Bun.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials' }), headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new LookupError('Spotify refused the bot\'s app credentials.');
  const r = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: r.access_token, until: Date.now() + r.expires_in * 1000 };
  return token.value;
}

async function sp<T>(path: string): Promise<T> {
  try { return await getJson<T>(`https://api.spotify.com/v1/${path}`, { headers: { Authorization: `Bearer ${await appToken()}` }, cacheMs: 5 * 60_000 }); }
  catch (e) { if (e instanceof HttpError && (e.status === 404 || e.status === 400)) throw new LookupError('Spotify couldn\'t find that.'); throw e; }
}

export interface SpTrack { id: string; name: string; artists: string[]; album: string; albumId?: string; image?: string; url: string; durationMs: number; explicit: boolean; isrc?: string; popularity?: number; releaseDate?: string; source: 'spotify' | 'deezer'; preview?: string }
export interface SpAlbum { id: string; name: string; artists: string[]; image?: string; url: string; releaseDate?: string; totalTracks: number; label?: string; tracks: { n: number; name: string; durationMs: number; explicit: boolean }[]; source: 'spotify' | 'deezer' }

type RawTrack = { id: string; name: string; artists: { name: string }[]; album: { id: string; name: string; images: { url: string }[]; release_date?: string }; external_urls: { spotify: string }; duration_ms: number; explicit: boolean; external_ids?: { isrc?: string }; popularity?: number };
export const parseSpTrack = (t: RawTrack): SpTrack => ({
  id: t.id, name: t.name, artists: t.artists.map(a => a.name), album: t.album.name, albumId: t.album.id, image: t.album.images[0]?.url, url: t.external_urls.spotify,
  durationMs: t.duration_ms, explicit: t.explicit, isrc: t.external_ids?.isrc, popularity: t.popularity, releaseDate: t.album.release_date, source: 'spotify',
});

type DzTrack = { id: number; title: string; artist: { name: string }; album: { id: number; title: string; cover_xl?: string; cover_big?: string }; link: string; duration: number; explicit_lyrics?: boolean; isrc?: string; preview?: string; rank?: number };
export const parseDzTrack = (t: DzTrack): SpTrack => ({
  id: String(t.id), name: t.title, artists: [t.artist.name], album: t.album.title, albumId: String(t.album.id), image: t.album.cover_xl ?? t.album.cover_big, url: t.link,
  durationMs: t.duration * 1000, explicit: !!t.explicit_lyrics, isrc: t.isrc, preview: t.preview || undefined, source: 'deezer',
});

/** open.spotify.com/track/<id>, spotify:track:<id>, or null. */
export function spotifyId(input: string, kind: 'track' | 'album'): string | null {
  const m = new RegExp(`(?:open\\.spotify\\.com/(?:intl-[a-z]+/)?${kind}/|spotify:${kind}:)([A-Za-z0-9]{22})`).exec(input);
  return m ? m[1]! : null;
}

export async function searchTracks(query: string, limit = 10): Promise<SpTrack[]> {
  const q = query.trim();
  if (!q || q.length > 200) throw new LookupError('Give me a song to search for.');
  const id = spotifyId(q, 'track');
  if (spotifyConfigured()) {
    if (id) return [parseSpTrack(await sp<RawTrack>(`tracks/${id}`))];
    const r = await sp<{ tracks: { items: RawTrack[] } }>(`search?type=track&limit=${limit}&q=${encodeURIComponent(q)}`);
    return r.tracks.items.map(parseSpTrack);
  }
  if (id) throw new LookupError('Looking up Spotify links needs the bot owner to set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET — try searching by name.');
  const r = await getJson<{ data?: DzTrack[] }>(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=${limit}`, { cacheMs: 5 * 60_000 });
  return (r.data ?? []).map(parseDzTrack);
}

export async function firstTrack(query: string): Promise<SpTrack> {
  const t = (await searchTracks(query, 1))[0];
  if (!t) throw new LookupError(`No songs found for **${query.slice(0, 80)}**.`);
  return t;
}

export async function album(query: string): Promise<SpAlbum> {
  const q = query.trim();
  if (spotifyConfigured()) {
    const id = spotifyId(q, 'album') ?? (await sp<{ albums: { items: { id: string }[] } }>(`search?type=album&limit=1&q=${encodeURIComponent(q)}`)).albums.items[0]?.id;
    if (!id) throw new LookupError(`No albums found for **${q.slice(0, 80)}**.`);
    const a = await sp<{ id: string; name: string; artists: { name: string }[]; images: { url: string }[]; external_urls: { spotify: string }; release_date?: string; total_tracks: number; label?: string; tracks: { items: { track_number: number; name: string; duration_ms: number; explicit: boolean }[] } }>(`albums/${id}`);
    return { id: a.id, name: a.name, artists: a.artists.map(x => x.name), image: a.images[0]?.url, url: a.external_urls.spotify, releaseDate: a.release_date, totalTracks: a.total_tracks, label: a.label,
      tracks: a.tracks.items.map(t => ({ n: t.track_number, name: t.name, durationMs: t.duration_ms, explicit: t.explicit })), source: 'spotify' };
  }
  const s = await getJson<{ data?: { id: number }[] }>(`https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=1`, { cacheMs: 5 * 60_000 });
  const id = s.data?.[0]?.id;
  if (!id) throw new LookupError(`No albums found for **${q.slice(0, 80)}**.`);
  const a = await getJson<{ id: number; title: string; artist: { name: string }; cover_xl?: string; link: string; release_date?: string; nb_tracks: number; label?: string; tracks: { data: { title: string; duration: number; explicit_lyrics?: boolean }[] } }>(`https://api.deezer.com/album/${id}`, { cacheMs: 5 * 60_000 });
  return { id: String(a.id), name: a.title, artists: [a.artist.name], image: a.cover_xl, url: a.link, releaseDate: a.release_date, totalTracks: a.nb_tracks, label: a.label,
    tracks: a.tracks.data.map((t, n) => ({ n: n + 1, name: t.title, durationMs: t.duration * 1000, explicit: !!t.explicit_lyrics })), source: 'deezer' };
}

/** A 30-second preview MP3 URL for a track: Deezer by ISRC (exact recording), else Deezer search by artist + title. */
export async function previewUrl(t: SpTrack): Promise<string | null> {
  if (t.preview) return t.preview;
  if (t.isrc) {
    const r = await getJson<{ preview?: string; error?: unknown }>(`https://api.deezer.com/track/isrc:${encodeURIComponent(t.isrc)}`, { cacheMs: 60 * 60_000 }).catch(() => null);
    if (r?.preview) return r.preview;
  }
  const r = await getJson<{ data?: DzTrack[] }>(`https://api.deezer.com/search?q=${encodeURIComponent(`artist:"${t.artists[0]}" track:"${t.name}"`)}&limit=1`, { cacheMs: 60 * 60_000 }).catch(() => null);
  return r?.data?.[0]?.preview || null;
}

export const fmtMs = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;
