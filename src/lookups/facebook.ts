import he from 'he';
import { getText, HttpError } from '../framework/http.js';
import { countAfter } from './fixembed.js';
import { LookupError } from './handler.js';
import type { RepostMedia, RepostPost } from './repost.js';

/**
 * Facebook posts through facebed (https://github.com/seriaati/facebed), the embed fixer for Facebook. Its page for a post carries the
 * card it gives Discord as JSON (<script id="discord:component-embed">): the author, the caption, the photos and videos, and the exact
 * reactions, comments, shares and time, which is read back here. Pages without it fall back to their Open Graph tags (no counts).
 * facebed only answers link-preview crawlers (anyone else is sent to Facebook), so it is asked as one, naming Bestow too.
 * Env: FACEBED_URL (default https://facebed.com).
 */

export const FACEBOOK_BLUE = 0x0866ff;
const FACEBED = (Bun.env.FACEBED_URL || 'https://facebed.com').replace(/\/+$/, '');
const PREVIEW_UA = 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com) BestowBot/1.0 (+https://github.com/Geckomacabre/Bestow-Bot)';

/** The path (and query) of a Facebook link, as facebed takes it; null for anything that isn't Facebook. fb.watch links are kept whole. */
export function parseFacebookUrl(link: string): { path: string } | { short: string } | null {
  let u: URL;
  try { u = new URL(link.trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (host === 'fb.watch') return /^\/[\w-]+\/?$/.test(u.pathname) ? { short: u.toString() } : null;
  if (!/^(?:(?:www|m|web|mbasic)\.)?facebook\.com$/.test(host) || u.pathname === '/') return null;
  return { path: `${u.pathname.replace(/^\/+/, '')}${u.search}` };
}

interface Comp { type: number; content?: string; components?: Comp[]; accessory?: { media?: { url?: string } }; items?: { media?: { url?: string } }[]; label?: string; url?: string }

/** Text facebed escaped for Discord's markdown, as plain text: escapes dropped, hashtag links back to hashtags. */
export function unescapeMd(s: string): string {
  return s
    .replace(/\[#((?:\\.|[^\]\\])+)\]\(https:\/\/www\.facebook\.com\/hashtag\/[^)\s]*\)/g, (_, tag: string) => `#${tag.replace(/\\(.)/g, '$1')}`)
    .replace(/^(\s*)\\(?=[#>\-+]|\d+\.)/gm, '$1')
    .replace(/\\([\\*_~`|[\]()<>])/g, '$1');
}

/** "[Name](url)" or plain "Name" (escaped), as name and url. */
function nameLink(s: string): { name: string; url?: string } {
  const m = /^\[((?:\\.|[^\]\\])*)\]\((\S+?)\)$/.exec(s.trim());
  return m ? { name: unescapeMd(m[1]!), url: m[2] } : { name: unescapeMd(s.trim()) };
}

const FOOTER = /^(?:(?:❤️|💬|🔁) \*\*[\d,]+\*\*|<t:\d+:[a-zA-Z]>)(?: · |$)/u;

/** facebed's component card as a repost; null if it doesn't hold a post. */
export function facebedPost(payload: unknown, link: string): RepostPost | null {
  const root = (payload as { component?: Comp })?.component;
  if (root?.type !== 17 || !root.components) return null;
  let header: string | undefined, caption: string | undefined, avatar: string | undefined, footer: string | undefined;
  let media: RepostMedia[] | undefined, shared: { line: string; text?: string } | undefined, open: string | undefined, profile: string | undefined;
  const text = (c: Comp) => {
    const t = c.content ?? '';
    if (t.startsWith('### ')) header = t;
    else if (t.startsWith('-# 🔁 Shared from')) shared = { line: t };
    else if (t.startsWith('-# ')) return; // "Shared post is unavailable" and other small print
    else if (shared && !shared.text && t.startsWith('> ')) shared.text = t;
    else if (FOOTER.test(t)) footer = t;
    else if (header && caption === undefined && !shared) caption = t;
  };
  for (const c of root.components) {
    if (c.type === 9) {
      const before = header;
      (c.components ?? []).forEach(text);
      if (!before && header && c.accessory?.media?.url) avatar = c.accessory.media.url;
    } else if (c.type === 10) text(c);
    else if (c.type === 12 && !shared && !media) {
      media = (c.items ?? []).flatMap(it => (it.media?.url?.startsWith('https://') ? [{ type: /\.mp4(\?|$)/i.test(it.media.url) ? 'video' as const : 'image' as const, url: it.media.url }] : []));
    } else if (c.type === 1) {
      for (const b of c.components ?? []) {
        if (b.label === 'Open on Facebook') open = b.url;
        else if (b.url && !profile) profile = b.url;
      }
    }
  }
  if (!header) return null;
  const [first, ...rest] = header.slice(4).split('\n');
  const verified = / ✓$/.test(first!);
  const who = nameLink(first!.replace(/ ✓$/, ''));
  const group = rest.map(l => /^-# 👥 (.+)$/.exec(l)?.[1]).find(Boolean);
  let body = caption ? unescapeMd(caption) : '';
  if (shared) {
    const from = nameLink(/^\*\*(.+?)\*\*/m.exec(shared.line.split('\n')[1] ?? '')?.[1] ?? '').name;
    const quoted = shared.text ? unescapeMd(shared.text) : '';
    body = [body, `🔁 Shared from **${from || 'a post'}**${quoted ? `\n${quoted}` : ''}`].filter(Boolean).join('\n\n');
  }
  const counts = (footer ?? '').replace(/\*\*/g, '');
  const time = /<t:(\d+):[a-zA-Z]>/.exec(footer ?? '')?.[1];
  return {
    site: 'Facebook', color: FACEBOOK_BLUE, url: open ?? link,
    author: { name: who.name || 'Facebook', url: who.url ?? profile, avatar, verified: verified || undefined, byline: group ? `👥 ${nameLink(group).name}` : undefined },
    text: body || undefined, createdAt: time ? Number(time) * 1000 : undefined,
    stats: [{ icon: '♡', value: countAfter(counts, '❤️') }, { icon: '💬', value: countAfter(counts, '💬') }, { icon: '↗️', value: countAfter(counts, '🔁') }],
    media: media ?? [],
  };
}

const meta = (html: string, prop: string) => [...html.matchAll(new RegExp(`<meta[^>]+property="${prop}"[^>]+content="([^"]*)"`, 'gi'))].map(m => he.decode(m[1]!));

/** A facebed page as a repost: its component card, or else its Open Graph tags. Null for its "log in" page (no post to show). */
export function facebedPage(html: string, link: string): RepostPost | null {
  const json = /<script id="discord:component-embed" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (json) { try { const p = facebedPost(JSON.parse(json), link); if (p) return p; } catch { /* the tags below */ } }
  const url = meta(html, 'og:url')[0];
  if (!url) return null;
  const media: RepostMedia[] = [...meta(html, 'og:video').map(u => ({ type: 'video' as const, url: u })), ...meta(html, 'og:image').map(u => ({ type: 'image' as const, url: u }))]
    .filter((m, n, all) => m.url.startsWith('https://') && all.findIndex(x => x.url === m.url) === n);
  return {
    site: 'Facebook', color: FACEBOOK_BLUE, url,
    author: { name: meta(html, 'og:title')[0] || 'Facebook' }, text: meta(html, 'og:description')[0] || undefined,
    stats: [], media,
  };
}

/** Fetches a page as text. Tests replace it. */
export type PageGet = (url: string) => Promise<string>;
const defaultGet: PageGet = url => getText(url, { cacheMs: 2 * 60_000, timeoutMs: 15_000, headers: { 'User-Agent': PREVIEW_UA, Accept: 'text/html' } });

/** Where an fb.watch link leads. */
async function followShort(url: string): Promise<string | null> {
  const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': PREVIEW_UA }, signal: AbortSignal.timeout(8_000) });
  void res.body?.cancel();
  return res.headers.get('location');
}

/** The post a Facebook link points to, read through facebed. */
export async function facebookPost(link: string, o: { get?: PageGet; follow?: (url: string) => Promise<string | null> } = {}): Promise<RepostPost> {
  let ref = parseFacebookUrl(link);
  if (ref && 'short' in ref) {
    const to = await (o.follow ?? followShort)(ref.short).catch(() => null);
    ref = to ? parseFacebookUrl(new URL(to, 'https://www.facebook.com').toString()) : null;
    if (!ref || 'short' in ref) throw new LookupError('I couldn\'t open that fb.watch link.');
  }
  if (!ref) throw new LookupError('Send a Facebook post, photo, video or reel link.');
  let html: string;
  try { html = await (o.get ?? defaultGet)(`${FACEBED}/${ref.path}`); }
  catch (e) { throw new LookupError(e instanceof HttpError && e.status === 404 ? 'facebed couldn\'t find that Facebook post.' : 'I couldn\'t reach facebed, which reads Facebook posts for me. Try again in a bit.'); }
  const post = facebedPage(html, `https://www.facebook.com/${ref.path}`);
  if (!post) throw new LookupError('Facebook won\'t show that post without a login — it may be private, in a private group, or deleted.');
  return post;
}
