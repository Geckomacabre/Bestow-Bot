import he from 'he';
import { getJson } from '../framework/http.js';
import type { RepostMedia } from './repost.js';

/**
 * Embed fixers that answer Mastodon's status API: the same JSON Discord reads when it embeds one of their links. One request gives the
 * whole post (caption, author, when it was posted, the counts and links to the media), which is why a repost from one is as quick as
 * /x repost is from FxTwitter. OGInstagram (https://github.com/seirenkr/OGInstagram) answers for Instagram and fxTikTok
 * (tnktok.com, https://github.com/okdargy/fxTikTok) for TikTok. Neither needs a key.
 */

export interface MastoStatus {
  url?: string;
  created_at?: string | null;
  content?: string | null;
  account?: { username?: string; display_name?: string; avatar?: string | null; url?: string } | null;
  media_attachments?: { type?: string; url?: string | null; preview_url?: string | null; description?: string | null }[] | null;
}

/** Fetches one status as JSON. Tests replace it. */
export type StatusGet = (url: string) => Promise<MastoStatus>;

/** Short enough that, should a fixer hang, the slower way it falls back to still answers in good time. */
export const getStatus: StatusGet = url => getJson<MastoStatus>(url, { cacheMs: 5 * 60_000, timeoutMs: 8_000 });

/** A status's HTML as plain text: line breaks and paragraphs are kept and links become their own text. */
export function htmlText(html: string): string {
  return he.decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n\n').replace(/<[^>]+>/g, '')).trim();
}

/** Its photos and videos (a gifv plays as a video); anything else, or anything not on https, is left out. */
export function statusMedia(s: MastoStatus): RepostMedia[] {
  return (s.media_attachments ?? [])
    .filter(m => /^(image|video|gifv)$/.test(m.type ?? '') && /^https:\/\//.test(m.url ?? ''))
    .map(m => ({ type: m.type === 'image' ? 'image' as const : 'video' as const, url: m.url!, thumb: m.preview_url || undefined }));
}

export const statusTime = (s: MastoStatus) => (s.created_at ? Date.parse(s.created_at) || undefined : undefined);

/** A count as these services print it: "12,345" → 12345, "1.2K" → 1200, "3M" → 3000000. Undefined if it isn't one. */
export function parseCount(s: string | undefined): number | undefined {
  const m = /^(\d[\d,]*(?:\.\d+)?)\s*([KMB])?$/i.exec(s?.trim() ?? '');
  if (!m) return undefined;
  const n = Number(m[1]!.replace(/,/g, '')) * (m[2] ? { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase() as 'K' | 'M' | 'B'] : 1);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

/** The count printed after `icon` in a stats line such as "▶️ 1,234  ❤️ 56  💬 7" (the emoji's variation selector is optional). */
export function countAfter(line: string, icon: string): number | undefined {
  const base = icon.replace(/️/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return parseCount(new RegExp(`${base}\\uFE0F?\\s*(\\d[\\d,]*(?:\\.\\d+)?[KMB]?)`, 'iu').exec(line)?.[1]);
}
