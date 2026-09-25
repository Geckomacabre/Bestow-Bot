import { card } from '../lookups/card.js';
import { cv2Err } from '../utils/components.js';
import type { Recognized } from './recognize.js';

/** The answer card for /shazam and the Identify Song menu. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function recognizedCard(r: Recognized | null): any {
  if (!r) return cv2Err('🤷 I couldn\'t recognize that song. Try a clearer or longer clip.');
  return card({
    title: r.title, url: r.songLink ?? r.spotify ?? r.apple, color: 0x0088ff, thumbnail: r.cover, description: `by **${r.artist}**${r.album ? `\n*${r.album}*` : ''}`,
    fields: [['Released', r.releaseDate], ['Label', r.label], ['Heard at', r.timecode]],
    links: [...(r.spotify ? [{ label: 'Spotify', url: r.spotify }] : []), ...(r.apple ? [{ label: 'Apple Music', url: r.apple }] : []), ...(r.songLink ? [{ label: 'All platforms', url: r.songLink }] : [])],
    footer: 'Recognized by AudD',
  });
}
