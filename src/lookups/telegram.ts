import he from 'he';
import { getJson, getText, HttpError } from '../framework/http.js';
import { LookupError } from './handler.js';

/**
 * Telegram lookups.
 *  - Keyless: the public preview pages at t.me/<name> (title, bio, photo, member/subscriber count, kind), t.me/s/<channel>
 *    (recent public posts), t.me/<channel>/<id>?embed=1 (one public message) and t.me/nft/<slug> (collectible gifts).
 *  - With TELEGRAM_BOT_TOKEN (any bot from @BotFather): the Bot API's getChat, which returns numeric IDs for public channels and groups.
 * Private accounts, phone numbers, and anything that needs a logged-in user session are out of scope.
 */

const PAGE_CACHE = 5 * 60_000;
export const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

export function cleanHandle(input: string): string {
  const s = input.trim().replace(/^https?:\/\/(www\.)?(t|telegram)\.me\//i, '').replace(/^@/, '').split(/[/?#]/)[0]!;
  if (!USERNAME_RE.test(s)) throw new LookupError('That isn\'t a valid Telegram username (5–32 letters, numbers or _).');
  return s;
}

const meta = (html: string, prop: string) => {
  const m = new RegExp(`<meta\\s+(?:property|name)="${prop}"\\s+content="([^"]*)"`, 'i').exec(html);
  return m ? he.decode(m[1]!).trim() : undefined;
};
const cls = (html: string, name: string) => {
  const m = new RegExp(`<div class="${name}"[^>]*>([\\s\\S]*?)</div>`, 'i').exec(html);
  return m ? he.decode(m[1]!.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim() : undefined;
};

export type PageKind = 'user' | 'bot' | 'channel' | 'group' | 'unknown';
export interface TgPage { handle: string; kind: PageKind; title: string; description?: string; photo?: string; extra?: string; members?: number; subscribers?: number; online?: number; verified: boolean }

/** "1 234 567 subscribers" / "12 345 members, 678 online" → numbers (Telegram groups digits with spaces). */
export const tgNumber = (s: string) => Number(s.replace(/[\s ,]/g, ''));

export function parsePage(html: string, handle: string): TgPage | null {
  const title = cls(html, 'tgme_page_title') ?? meta(html, 'og:title');
  // A username nobody owns renders the generic "Telegram: Contact @x" page with no title block.
  if (!title || /^Telegram: (Contact|Join|View)/.test(title) && !html.includes('tgme_page_title')) return null;
  const extra = cls(html, 'tgme_page_extra');
  const description = cls(html, 'tgme_page_description') ?? meta(html, 'og:description');
  const photo = /<img class="tgme_page_photo_image"[^>]*src="([^"]+)"/i.exec(html)?.[1];
  const subs = extra && /([\d\s ,]+)\s+subscribers?/i.exec(extra);
  const mem = extra && /([\d\s ,]+)\s+members?/i.exec(extra);
  const onl = extra && /([\d\s ,]+)\s+online/i.exec(extra);
  // Channels show subscribers, groups show members; Telegram requires every bot username to end in "bot".
  const kind: PageKind = subs ? 'channel' : mem ? 'group' : /bot$/i.test(handle) ? 'bot' : 'user';
  return {
    handle, kind, title, description: description && description !== title ? description : undefined, photo, extra,
    subscribers: subs ? tgNumber(subs[1]!) : undefined, members: mem ? tgNumber(mem[1]!) : undefined, online: onl ? tgNumber(onl[1]!) : undefined,
    verified: /verified-icon|tgme_page_title[^>]*>[\s\S]{0,300}verified/i.test(html),
  };
}

export async function page(input: string): Promise<TgPage> {
  const handle = cleanHandle(input);
  const html = await getText(`https://t.me/${handle}`, { cacheMs: PAGE_CACHE, headers: { 'Accept-Language': 'en' } });
  const p = parsePage(html, handle);
  if (!p) throw new LookupError(`There's no public Telegram account called **@${handle}**.`);
  return p;
}

export interface TgPost { id: number; text: string; date?: string; views?: string; photo?: string; hasVideo: boolean; link: string }

/** Recent posts from t.me/s/<channel> (only public channels have this page). */
export function parsePosts(html: string, handle: string): TgPost[] {
  const out: TgPost[] = [];
  const re = /<div class="tgme_widget_message_wrap[\s\S]*?data-post="[^/"]+\/(\d+)"([\s\S]*?)(?=<div class="tgme_widget_message_wrap|<\/section>|$)/g;
  for (const m of html.matchAll(re)) {
    const body = m[2]!;
    const text = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(body)?.[1];
    out.push({
      id: Number(m[1]),
      text: text ? he.decode(text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim() : '',
      date: /<time[^>]*datetime="([^"]+)"/.exec(body)?.[1],
      views: /<span class="tgme_widget_message_views">([^<]+)<\/span>/.exec(body)?.[1],
      photo: /tgme_widget_message_photo_wrap[^"]*"[^>]*style="[^"]*background-image:url\('([^']+)'\)/.exec(body)?.[1],
      hasVideo: /tgme_widget_message_video/.test(body),
      link: `https://t.me/${handle}/${m[1]}`,
    });
  }
  return out;
}

export async function recentPosts(handle: string): Promise<TgPost[]> {
  try {
    return parsePosts(await getText(`https://t.me/s/${cleanHandle(handle)}`, { cacheMs: PAGE_CACHE }), handle);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return [];
    throw e;
  }
}

export interface TgMessage { channel: string; id: number; author?: string; text: string; date?: string; views?: string; photo?: string; hasVideo: boolean; link: string }

export function parseMessageLink(input: string): { channel: string; id: number } {
  const m = /^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\/(?:s\/)?([A-Za-z][A-Za-z0-9_]{3,31})\/(\d{1,12})/i.exec(input.trim());
  if (!m) throw new LookupError('Send a public message link like `https://t.me/durov/123`. (Private `t.me/c/…` links can\'t be read.)');
  return { channel: m[1]!, id: Number(m[2]) };
}

export function parseEmbed(html: string, channel: string, id: number): TgMessage | null {
  if (/tgme_widget_message_error/.test(html)) return null;
  const text = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1];
  const author = /<a class="tgme_widget_message_owner_name"[^>]*>(?:<span[^>]*>)?([^<]+)/.exec(html)?.[1];
  if (!text && !author) return null;
  return {
    channel, id, author: author ? he.decode(author).trim() : undefined,
    text: text ? he.decode(text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim() : '',
    date: /<time[^>]*datetime="([^"]+)"/.exec(html)?.[1], views: /<span class="tgme_widget_message_views">([^<]+)<\/span>/.exec(html)?.[1],
    photo: /tgme_widget_message_photo_wrap[^"]*"[^>]*style="[^"]*background-image:url\('([^']+)'\)/.exec(html)?.[1],
    hasVideo: /tgme_widget_message_video/.test(html), link: `https://t.me/${channel}/${id}`,
  };
}

export async function message(link: string): Promise<TgMessage> {
  const { channel, id } = parseMessageLink(link);
  const m = parseEmbed(await getText(`https://t.me/${channel}/${id}?embed=1&mode=tme`, { cacheMs: PAGE_CACHE }), channel, id);
  if (!m) throw new LookupError('I couldn\'t read that message (it may be deleted, or the chat isn\'t public).');
  return m;
}

export interface TgGift { slug: string; title: string; number?: string; attributes: [string, string][]; image?: string; owner?: string }

/** t.me/nft/<Name>-<n>: og:title "Plush Pepe #1", attribute rows in a <table class="tgme_gift_table">. */
export function parseGift(html: string, slug: string): TgGift | null {
  const title = meta(html, 'og:title');
  if (!title || /^Telegram/.test(title)) return null;
  const attributes: [string, string][] = [];
  const table = /<table class="tgme_gift_table"[\s\S]*?<\/table>/i.exec(html)?.[0] ?? '';
  for (const r of table.matchAll(/<th>([^<]+)<\/th>\s*<td>([\s\S]*?)<\/td>/gi)) attributes.push([he.decode(r[1]!).trim(), he.decode(r[2]!.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()]);
  const desc = meta(html, 'og:description');
  if (!attributes.length && desc) for (const line of desc.split('\n')) { const kv = /^([^:]{2,20}):\s*(.+)$/.exec(line.trim()); if (kv) attributes.push([kv[1]!, kv[2]!]); }
  return { slug, title, number: /#\s?([\d,]+)/.exec(title)?.[1], attributes, image: meta(html, 'og:image'), owner: attributes.find(([k]) => /owner/i.test(k))?.[1] };
}

export function cleanGiftSlug(input: string): string {
  const s = input.trim().replace(/^https?:\/\/(www\.)?t\.me\/nft\//i, '').split(/[/?#]/)[0]!;
  if (!/^[A-Za-z][A-Za-z0-9]{1,40}-\d{1,7}$/.test(s)) throw new LookupError('Give me a gift slug like `PlushPepe-1` (or its t.me/nft link).');
  return s;
}

export async function gift(input: string): Promise<TgGift> {
  const slug = cleanGiftSlug(input);
  const g = parseGift(await getText(`https://t.me/nft/${slug}`, { cacheMs: PAGE_CACHE }), slug);
  if (!g) throw new LookupError(`I couldn't find the gift **${slug}**.`);
  return g;
}

/** Bot API getChat — numeric IDs for public channels/groups (and the bot's own chats). Needs TELEGRAM_BOT_TOKEN. */
export async function getChat(handle: string): Promise<{ id: number; type: string; title?: string; username?: string; first_name?: string }> {
  const token = Bun.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new LookupError('Looking up Telegram IDs needs a Telegram bot token, which the bot owner hasn\'t set (TELEGRAM_BOT_TOKEN).');
  let r: { ok: boolean; result?: { id: number; type: string; title?: string; username?: string; first_name?: string }; description?: string };
  try {
    r = await getJson(`https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(`@${cleanHandle(handle)}`)}`, { cacheMs: PAGE_CACHE });
  } catch (e) {
    if (e instanceof HttpError && e.status === 400) throw new LookupError('Telegram only reveals IDs for public channels and groups to bots — not for personal accounts.');
    throw e;
  }
  if (!r.ok || !r.result) throw new LookupError('Telegram only reveals IDs for public channels and groups to bots — not for personal accounts.');
  return r.result;
}
