import { getJson, getJsonPublic, HttpError } from '../framework/http.js';
import { LookupError } from './handler.js';
import type { RepostMedia, RepostPost } from './repost.js';

/**
 * Bluesky posts through its public AppView API (public.api.bsky.app: no key, no login): the text, the author, when it was posted, the
 * counts and the media. Photos are on Bluesky's CDN. Its CDN only streams a video as HLS, which Discord can't play, so a video is linked
 * as the MP4 the poster uploaded, from their own server (their PDS, found in their DID document).
 */

export const BLUESKY_BLUE = 0x1185fe;
const APPVIEW = 'https://public.api.bsky.app/xrpc';

/** The account (a handle or a DID) and record key in a post link, or null for anything else. */
export function parseBskyUrl(link: string): { actor: string; rkey: string } | null {
  const m = /^https:\/\/(?:www\.)?bsky\.app\/profile\/([^/?#]+)\/post\/([\w.~:-]{1,64})\/?(?:[?#]|$)/i.exec(link.trim());
  if (!m) return null;
  const actor = decodeURIComponent(m[1]!);
  return /^did:(plc|web):[\w.:%-]+$/.test(actor) || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(actor) ? { actor, rkey: m[2]! } : null;
}

/** The parts of the API's answers the card uses (app.bsky.feed.defs#postView and the embed views). */
interface BskyEmbed {
  $type?: string;
  images?: { fullsize?: string; thumb?: string; alt?: string }[];
  cid?: string; playlist?: string; thumbnail?: string;
  external?: { uri?: string; title?: string; thumb?: string };
  media?: BskyEmbed;
}
export interface BskyPostView {
  uri: string;
  author: { did: string; handle: string; displayName?: string; avatar?: string; verification?: { verifiedStatus?: string } | null };
  record: { text?: string; createdAt?: string; langs?: string[]; facets?: { index: { byteStart: number; byteEnd: number }; features?: { $type?: string; uri?: string }[] }[] };
  embed?: BskyEmbed;
  replyCount?: number; repostCount?: number; likeCount?: number; quoteCount?: number; bookmarkCount?: number;
  labels?: { val: string }[];
  indexedAt?: string;
}

/** Fetches JSON from the API. Tests replace it; `user` is set for a URL that came from a DID document (it must be public). */
export type BskyGet = (url: string, user?: boolean) => Promise<unknown>;
const defaultGet: BskyGet = (url, user) => (user ? getJsonPublic(url, { timeoutMs: 8_000 }) : getJson(url, { cacheMs: 2 * 60_000, timeoutMs: 8_000 }));

/** Labels that put a post behind a spoiler. */
const SENSITIVE = new Set(['porn', 'sexual', 'nudity', 'graphic-media', 'gore']);

/**
 * The text with its links written out in full: Bluesky shortens a long link in the text ("example.com/some-lo...") and keeps the real
 * one in a facet, placed by UTF-8 byte offsets.
 */
export function expandLinks(text: string, facets: BskyPostView['record']['facets'] = []): string {
  const links = facets.flatMap(f => {
    const uri = f.features?.find(x => x.$type === 'app.bsky.richtext.facet#link' && x.uri)?.uri;
    return uri ? [{ start: f.index.byteStart, end: f.index.byteEnd, uri }] : [];
  }).sort((a, b) => b.start - a.start);
  let bytes = Buffer.from(text, 'utf8'), floor = Infinity;
  for (const l of links) {
    if (l.start < 0 || l.end > bytes.length || l.start >= l.end || l.end > floor) continue; // out of range, or overlapping the last one
    bytes = Buffer.concat([bytes.subarray(0, l.start), Buffer.from(l.uri), bytes.subarray(l.end)]);
    floor = l.start;
  }
  return bytes.toString('utf8');
}

/** The photos, video or GIF in a post's embed (also inside a quote with media). `videoUrl` turns a video's blob id into a link. */
export function bskyMedia(e: BskyEmbed | undefined, videoUrl: (cid: string) => string | null): RepostMedia[] {
  if (!e) return [];
  switch (e.$type) {
    case 'app.bsky.embed.images#view':
      return (e.images ?? []).filter(i => i.fullsize?.startsWith('https://')).map(i => ({ type: 'image' as const, url: i.fullsize!, thumb: i.thumb }));
    case 'app.bsky.embed.video#view': {
      const url = e.cid ? videoUrl(e.cid) : null;
      return url ? [{ type: 'video', url, thumb: e.thumbnail }] : [];
    }
    case 'app.bsky.embed.recordWithMedia#view':
      return bskyMedia(e.media, videoUrl);
    case 'app.bsky.embed.external#view': {
      // A GIF from Bluesky's picker is a link to Tenor.
      const uri = e.external?.uri ?? '';
      return /^https:\/\/media\.tenor\.com\/[^?#]+\.gif(\?|$)/i.test(uri) ? [{ type: 'image', url: uri }] : [];
    }
    default:
      return [];
  }
}

/** A post as a repost. `pds` is the poster's server, needed only for a video. */
export function bskyPost(v: BskyPostView, pds: string | null): RepostPost {
  const did = v.author.did, rkey = v.uri.split('/').pop()!;
  const videoUrl = (cid: string) => (pds ? `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}` : null);
  return {
    site: 'Bluesky', color: BLUESKY_BLUE, url: `https://bsky.app/profile/${v.author.handle}/post/${rkey}`,
    author: { name: v.author.displayName?.trim() || v.author.handle, handle: v.author.handle, avatar: v.author.avatar, url: `https://bsky.app/profile/${v.author.handle}`, verified: v.author.verification?.verifiedStatus === 'valid' || undefined },
    text: expandLinks(v.record.text ?? '', v.record.facets).trim() || undefined, lang: v.record.langs?.[0],
    createdAt: Date.parse(v.record.createdAt ?? v.indexedAt ?? '') || undefined,
    stats: [{ icon: '♡', value: v.likeCount }, { icon: '💬', value: v.replyCount }, { icon: '🔁', value: v.repostCount }, { icon: '🔖', value: v.bookmarkCount || null }, { icon: '', value: v.quoteCount || null, suffix: ' quotes' }],
    media: bskyMedia(v.embed, videoUrl),
    sensitive: v.labels?.some(l => SENSITIVE.has(l.val)) || undefined,
  };
}

/** Where an account's data lives (its PDS), from its DID document; null if that can't be found. */
export async function pdsOf(did: string, get: BskyGet = defaultGet): Promise<string | null> {
  const docUrl = did.startsWith('did:plc:') ? `https://plc.directory/${did}`
    : did.startsWith('did:web:') ? `https://${decodeURIComponent(did.slice(8)).replace(/:/g, '/')}/.well-known/did.json` : null;
  if (!docUrl) return null;
  const doc = await get(docUrl, did.startsWith('did:web:')).catch(() => null) as { service?: { id?: string; type?: string; serviceEndpoint?: string }[] } | null;
  const ep = doc?.service?.find(s => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer')?.serviceEndpoint;
  return ep && /^https:\/\/[^/?#]+\/?$/.test(ep) ? ep.replace(/\/$/, '') : null;
}

/** The post a Bluesky link points to. */
export async function blueskyPost(link: string, get: BskyGet = defaultGet): Promise<RepostPost> {
  const ref = parseBskyUrl(link);
  if (!ref) throw new LookupError('Send a Bluesky post link like `https://bsky.app/profile/name.bsky.social/post/3k…`.');
  let did = ref.actor;
  try {
    if (!did.startsWith('did:')) did = ((await get(`${APPVIEW}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(did)}`)) as { did?: string }).did ?? '';
    if (!did) throw new LookupError(`There's no Bluesky account called **@${ref.actor}**.`);
    const { posts } = (await get(`${APPVIEW}/app.bsky.feed.getPosts?uris=${encodeURIComponent(`at://${did}/app.bsky.feed.post/${ref.rkey}`)}`)) as { posts?: BskyPostView[] };
    const v = posts?.[0];
    if (!v) throw new LookupError('That Bluesky post doesn\'t exist, or it\'s only visible to signed-in users.');
    const hasVideo = (e?: BskyEmbed): boolean => e?.$type === 'app.bsky.embed.video#view' || (e?.$type === 'app.bsky.embed.recordWithMedia#view' && hasVideo(e.media));
    return bskyPost(v, hasVideo(v.embed) ? await pdsOf(v.author.did, get) : null);
  } catch (e) {
    if (e instanceof HttpError && e.status === 400) throw new LookupError(`There's no Bluesky account called **@${ref.actor}**.`);
    throw e;
  }
}
