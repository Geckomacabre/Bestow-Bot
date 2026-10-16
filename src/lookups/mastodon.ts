import { getJsonPublic, HttpError } from '../framework/http.js';
import { htmlText, statusMedia, type MastoStatus } from './fixembed.js';
import { LookupError } from './handler.js';
import type { RepostPost } from './repost.js';

/**
 * Mastodon and the rest of the fediverse that speaks its API (Pleroma, Akkoma, GoToSocial, Truth Social…): each server answers
 * GET /api/v1/statuses/<id> for a public post without a login. The server is whatever the link names, so it is only contacted when it
 * (and anything it redirects to) is a public address.
 */

export const MASTODON_PURPLE = 0x6364ff;

/** The server and post id in a link to a post on a fediverse server, or null when the path isn't one of a post. */
export function parseFediUrl(link: string): { host: string; id: string } | null {
  let u: URL;
  try { u = new URL(link.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  const m = /^\/@[^/]+\/(?:posts\/)?(\d{1,20})\/?$/.exec(u.pathname) // Mastodon /@user/123, Truth Social /@user/posts/123
    ?? /^\/users\/[^/]+\/statuses\/(\d{1,20})\/?$/.exec(u.pathname) // the ActivityPub URL of a Mastodon post
    ?? /^\/web\/statuses\/(\d{1,20})\/?$/.exec(u.pathname)
    ?? /^\/notice\/([A-Za-z0-9]{1,40})\/?$/.exec(u.pathname); // Pleroma and Akkoma
  return m ? { host: u.host.toLowerCase(), id: m[1]! } : null;
}

/** What the card uses of a Mastodon status, beyond what tnktok and OGInstagram send. */
export interface FediStatus extends MastoStatus {
  account?: MastoStatus['account'] & { acct?: string; emojis?: { shortcode: string }[] };
  language?: string | null; spoiler_text?: string; sensitive?: boolean;
  replies_count?: number; reblogs_count?: number; favourites_count?: number;
  reblog?: FediStatus | null;
}

export type FediGet = (url: string) => Promise<unknown>;
const defaultGet: FediGet = url => getJsonPublic(url, { timeoutMs: 8_000 });

/** A status as a repost. A boost is shown as the post it boosted. */
export function fediPost(raw: FediStatus, host: string): RepostPost | null {
  const s = raw.reblog ?? raw;
  const acct = s.account?.acct ?? s.account?.username;
  if (!acct || !s.url) return null;
  // Custom emoji are :shortcodes: in a display name; without their pictures they are noise.
  const name = (s.account?.display_name ?? '').replace(/:([\w+-]+):/g, (all, code) => (s.account?.emojis?.some(e => e.shortcode === code) ? '' : all)).trim();
  const text = htmlText(s.content ?? '');
  const warning = s.spoiler_text?.trim();
  return {
    site: host, color: MASTODON_PURPLE, url: s.url,
    author: { name: name || acct, handle: acct.includes('@') ? acct : `${acct}@${host}`, avatar: s.account?.avatar || undefined, url: s.account?.url },
    text: (warning ? `⚠️ ${warning}\n\n${text}` : text) || undefined, lang: s.language || undefined,
    createdAt: Date.parse(s.created_at ?? '') || undefined,
    stats: [{ icon: '♡', value: s.favourites_count }, { icon: '💬', value: s.replies_count }, { icon: '🔁', value: s.reblogs_count }],
    media: statusMedia(s), sensitive: !!s.sensitive || !!warning || undefined,
  };
}

/** The post a fediverse link points to. */
export async function fediversePost(link: string, get: FediGet = defaultGet): Promise<RepostPost> {
  const ref = parseFediUrl(link);
  if (!ref) throw new LookupError('That doesn\'t look like a link to a Mastodon (or other fediverse) post.');
  let raw: FediStatus;
  try { raw = (await get(`https://${ref.host}/api/v1/statuses/${encodeURIComponent(ref.id)}`)) as FediStatus; }
  catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 403)) throw new LookupError(`**${ref.host}** only shows that post to signed-in users.`);
    if (e instanceof HttpError && e.status === 404) throw new LookupError(`**${ref.host}** doesn't have that post (it may be deleted or private).`);
    throw new LookupError(`I couldn't read that post from **${ref.host}** — it may not be a Mastodon-compatible server.`);
  }
  const post = raw && typeof raw === 'object' ? fediPost(raw, ref.host) : null;
  if (!post) throw new LookupError(`I couldn't read that post from **${ref.host}**.`);
  return post;
}
