import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { download, ffmpeg, MediaError, probe, withWorkdir, type MediaRef } from '../framework/media.js';
import { LookupError } from '../lookups/handler.js';

/**
 * Song recognition for /shazam and the Identify Song menu. Shazam has no public API, so this uses AudD (AUDD_API_TOKEN, free
 * trial at audd.io): a 15-second clip from the middle of the file is sent, never the whole upload.
 */

export interface Recognized { title: string; artist: string; album?: string; releaseDate?: string; label?: string; timecode?: string; songLink?: string; spotify?: string; apple?: string; cover?: string }

type AuddResult = {
  title: string; artist: string; album?: string; release_date?: string; label?: string; timecode?: string; song_link?: string;
  spotify?: { external_urls?: { spotify?: string }; album?: { images?: { url: string }[] } } | null;
  apple_music?: { url?: string; artwork?: { url?: string } } | null;
};

export function parseAudd(r: { status: string; result?: AuddResult | null; error?: { error_message?: string } }): Recognized | null {
  if (r.status !== 'success') throw new LookupError(`The recognition service said: ${r.error?.error_message ?? 'error'}`);
  const x = r.result;
  if (!x) return null;
  const cover = x.spotify?.album?.images?.[0]?.url ?? x.apple_music?.artwork?.url?.replace('{w}', '600').replace('{h}', '600');
  return { title: x.title, artist: x.artist, album: x.album, releaseDate: x.release_date, label: x.label, timecode: x.timecode, songLink: x.song_link, spotify: x.spotify?.external_urls?.spotify, apple: x.apple_music?.url, cover };
}

export async function recognize(ref: MediaRef): Promise<Recognized | null> {
  const key = Bun.env.AUDD_API_TOKEN;
  if (!key) throw new LookupError('Song recognition isn\'t set up on this bot (AUDD_API_TOKEN).');
  const clip = await withWorkdir(async dir => {
    const file = await download(ref, dir);
    const info = await probe(file, dir);
    if (!info.hasAudio) throw new MediaError('That file has no sound in it.');
    const start = info.duration > 25 ? Math.floor(info.duration / 2 - 7) : 0;
    await ffmpeg(['-ss', String(start), '-t', '15', '-i', file, '-vn', '-ac', '1', '-ar', '44100', '-b:a', '128k', 'clip.mp3'], { cwd: dir });
    return readFile(path.join(dir, 'clip.mp3'));
  });
  const form = new FormData();
  form.set('api_token', key);
  form.set('return', 'spotify,apple_music');
  form.set('file', new Blob([clip], { type: 'audio/mpeg' }), 'clip.mp3');
  const res = await fetch('https://api.audd.io/', { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new LookupError('The recognition service didn\'t answer — try again.');
  return parseAudd((await res.json()) as Parameters<typeof parseAudd>[0]);
}
