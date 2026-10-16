import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, SectionBuilder,
  SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder, type ChatInputCommandInteraction,
} from 'discord.js';
import { getBufferPublic } from '../framework/http.js';
import { uploadLimit } from '../framework/media.js';
import type { PostInfo } from '../media/download.js';
import { trunc } from './card.js';
import { languageName, localeLang } from './languages.js';
import { gtranslate } from './textfun.js';

/**
 * The Heist-style repost card shared by /x repost, /tiktok repost, /instagram repost, /medaltv repost and /repost:
 *   name ☑️ / @handle • 18 hours ago   [avatar]
 *   post text
 *   🌐 Translated from Japanese / the text in the reader's language (when it's in another one)
 *   [the video or photos, playable inline]
 *   ♡ 906 · 💬 105 · 🔖 66 · 🔁 23 · 24k views
 *   [Open on X] [Author]
 * Media is downloaded and attached so it plays inside Discord (CDN links from most of these sites expire or refuse hotlinking). Where the
 * links do neither for a while (Instagram's, TikTok's, Bluesky's…), the card goes out first with the links (sendRepostFast) and is
 * upgraded to files afterwards. A post in another language than the one the invoker reads Discord in is translated on the way.
 */

export interface RepostMedia { type: 'video' | 'image' | 'gif'; url: string; thumb?: string; /** Already downloaded (e.g. by yt-dlp). */ data?: Buffer; ext?: string }
export interface RepostPost {
  site: string;
  color: number;
  /** `byline` replaces "@handle" under the name, for sites without handles ("u/spez", "👥 A group"). */
  author: { name: string; handle?: string; avatar?: string; url?: string; verified?: boolean; byline?: string };
  text?: string;
  /** The language the site says the text is in, when it says (an ISO code such as "ja"): a post already in the reader's isn't translated. */
  lang?: string;
  createdAt?: number;
  url: string;
  stats: { icon: string; value: number | null | undefined; suffix?: string }[];
  media: RepostMedia[];
  sensitive?: boolean;
}

export const VERIFIED = '☑️';

/** 906 → "906", 24_310 → "24.3k", 1_200_000 → "1.2m" (Heist's footer style). */
export function shortCount(n: number): string {
  const a = Math.abs(n);
  const f = (x: number, u: string) => `${x >= 100 ? Math.round(x) : +x.toFixed(1)}${u}`;
  if (a >= 1e9) return f(n / 1e9, 'b');
  if (a >= 1e6) return f(n / 1e6, 'm');
  if (a >= 1e3) return f(n / 1e3, 'k');
  return String(n);
}

export function statsLine(stats: RepostPost['stats']): string {
  return stats.filter(s => s.value != null).map(s => `${s.icon ? `${s.icon} ` : ''}${shortCount(s.value!)}${s.suffix ?? ''}`).join(' · ');
}

const extOf = (m: RepostMedia, url: string) => m.type === 'image' ? (/\.(png|webp|gif)(\?|$)/i.exec(url)?.[1]?.toLowerCase() ?? 'jpg') : m.type === 'gif' ? 'mp4' : 'mp4';

/** How many files are fetched at the same time: enough that a carousel isn't slow, few enough not to hold many large files in memory. */
const PARALLEL_DOWNLOADS = 4;

/** Fetches each item (a few at a time); one that can't be fetched, or is over `limit` on its own, comes back null. */
async function downloadAll(wanted: RepostMedia[], limit: number, headers?: Record<string, string>): Promise<(Buffer | null)[]> {
  const bufs: (Buffer | null)[] = new Array(wanted.length).fill(null);
  let next = 0;
  const worker = async () => {
    for (let n = next++; n < wanted.length; n = next++) {
      const m = wanted[n]!;
      try { bufs[n] = m.data ?? await getBufferPublic(m.url, { maxBytes: Math.max(1, limit), timeoutMs: 45_000, headers }); } catch { /* left null: it stays a link */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_DOWNLOADS, wanted.length) }, worker));
  return bufs;
}

/**
 * Downloads up to 10 items within the upload limit; anything that doesn't fit stays a link. The files come down a few at a time, and
 * are then taken in order for as long as the total fits, so the result is the same as fetching them one by one, only faster.
 */
export async function fetchMedia(media: RepostMedia[], limit: number, headers?: Record<string, string>): Promise<{ files: AttachmentBuilder[]; items: string[]; skipped: RepostMedia[] }> {
  const wanted = media.slice(0, 10);
  const bufs = await downloadAll(wanted, limit, headers);

  const files: AttachmentBuilder[] = [], items: string[] = [], skipped: RepostMedia[] = [];
  let used = 0;
  for (const [n, m] of wanted.entries()) {
    const buf = bufs[n];
    if (!buf || used + buf.length > limit) { skipped.push(m); continue; }
    used += buf.length;
    const name = `${m.type === 'image' ? 'photo' : 'video'}${n + 1}.${m.ext ?? extOf(m, m.url)}`;
    files.push(new AttachmentBuilder(buf, { name }));
    items.push(`attachment://${name}`);
  }
  return { files, items, skipped };
}

// ─── Translation ─────────────────────────────────────────────────────────────

/** A post's text in the reader's language, and the language it was written in (a Google Translate code). */
export interface Translation { text: string; from: string }

/** Translates a post's text into `to`: null when there is nothing to translate, it's in that language already, or it can't be done. */
export type Translator = (p: RepostPost, to: string) => Promise<Translation | null>;

/** The most of a post that is translated (the free endpoint takes it in the URL), as /translate does. */
const TRANSLATE_MAX = 1500;
const baseLang = (code: string) => code.toLowerCase().split('-')[0]!;
/** Worth translating: a couple of letters at least once links, @mentions, #tags, emoji, digits and punctuation are taken out. */
const hasWords = (s: string) => s.replace(/https?:\/\/\S+/g, '').replace(/[@#][\p{L}\p{N}_.]+/gu, '').replace(/[^\p{L}]/gu, '').length >= 2;

/**
 * A translator using Google Translate (by default the free endpoint /translate uses), which detects the language too. A post that says
 * it is in the reader's language, or has no words to translate, isn't sent at all. REPOST_TRANSLATE=off turns translation off.
 */
export function googleTranslator(translate: typeof gtranslate = gtranslate): Translator {
  return async (p, to) => {
    const text = p.text?.trim();
    if (!text || /^(0|off|false|no)$/i.test(Bun.env.REPOST_TRANSLATE ?? '')) return null;
    if ((p.lang && baseLang(p.lang) === baseLang(to)) || !hasWords(text)) return null;
    try {
      const r = await translate(text.slice(0, TRANSLATE_MAX), to);
      if (!r.detected || baseLang(r.detected) === baseLang(to) || r.text.trim() === text) return null;
      return { text: r.text.trim(), from: r.detected };
    } catch { return null; }
  };
}

export const translatePost: Translator = googleTranslator();

/** Leaves the post as it is (for /repost translate:false). */
export const noTranslation: Translator = async () => null;

/** How long the quick card waits for its translation; one that comes later is added when the media are swapped in. */
const TRANSLATE_WAIT_MS = 2500;

const quoteLines = (s: string) => s.split('\n').map(l => `> ${l}`).join('\n');

// ─── The card ────────────────────────────────────────────────────────────────

export function repostCard(p: RepostPost, attached: { files: AttachmentBuilder[]; items: string[]; skipped: RepostMedia[] }, links: { open: string; authorUrl?: string }, tr?: Translation | null) {
  const head = [
    `### ${trunc(p.author.name, 80)}${p.author.verified ? ` ${VERIFIED}` : ''}`,
    [p.author.byline ?? (p.author.handle ? `@${p.author.handle}` : null), p.createdAt ? `<t:${Math.floor(p.createdAt / 1000)}:R>` : null].filter(Boolean).join(' • '),
  ].filter(Boolean).join('\n');
  const c = new ContainerBuilder().setAccentColor(p.color);
  if (p.author.avatar) c.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(head)).setThumbnailAccessory(new ThumbnailBuilder().setURL(p.author.avatar)));
  else c.addTextDisplayComponents(new TextDisplayBuilder().setContent(head));
  // A message's text can't pass 4000 characters in all, so the original and its translation share the room one text had.
  const room = tr ? 1400 : 1800;
  if (p.text?.trim()) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(trunc(p.text.trim(), room)));
  if (tr) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# 🌐 Translated from ${languageName(tr.from)}\n${trunc(quoteLines(tr.text), room)}`));
  if (attached.items.length) {
    const g = new MediaGalleryBuilder();
    for (const u of attached.items) g.addItems(new MediaGalleryItemBuilder().setURL(u).setSpoiler(!!p.sensitive));
    c.addMediaGalleryComponents(g);
  }
  if (attached.skipped.length) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${attached.skipped.length} item${attached.skipped.length === 1 ? ' was' : 's were'} too big to attach: ${attached.skipped.map((m, n) => `[${m.type} ${n + 1}](${m.url})`).join(' · ')}`));
  const line = statsLine(p.stats);
  if (line) c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)).addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${line}`));
  const buttons = [new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(links.open).setURL(p.url)];
  if (links.authorUrl) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Author').setURL(links.authorUrl));
  c.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons));
  return { flags: MessageFlags.IsComponentsV2 as const, components: [c], files: attached.files, allowedMentions: { parse: [] as never[] } };
}

export interface SendOptions {
  /** Sent with each media download. */
  headers?: Record<string, string>;
  /** Default: Google Translate into the invoker's Discord language. */
  translate?: Translator;
}

/** The translation for the invoker; never fails. */
const translationFor = (i: ChatInputCommandInteraction, p: RepostPost, o: SendOptions) => (o.translate ?? translatePost)(p, localeLang(i.locale)).catch(() => null);

/** Fetch the media (and the translation, at the same time) and send the card as the interaction's reply (it must already be deferred). */
export async function sendRepost(i: ChatInputCommandInteraction, p: RepostPost, links: { open: string; authorUrl?: string }, o: SendOptions = {}) {
  const [attached, tr] = await Promise.all([fetchMedia(p.media, Math.floor(uploadLimit(i) * 0.95), o.headers), translationFor(i, p, o)]);
  await i.editReply(repostCard(p, attached, links, tr));
}

/**
 * Downloads up to 10 items, and attaches those that fit within `limit` (together, in order); the others keep pointing at their own
 * link. Nothing is skipped and the order never changes, so this can replace a card whose media are all links. `attached` is how many
 * became files.
 */
export async function attachWhatFits(media: RepostMedia[], limit: number, headers?: Record<string, string>): Promise<{ files: AttachmentBuilder[]; items: string[]; attached: number }> {
  const wanted = media.slice(0, 10);
  const bufs = await downloadAll(wanted, limit, headers);
  const files: AttachmentBuilder[] = [], items: string[] = [];
  let used = 0;
  for (const [n, m] of wanted.entries()) {
    const buf = bufs[n];
    if (!buf || used + buf.length > limit) { items.push(m.url); continue; }
    used += buf.length;
    const name = `${m.type === 'image' ? 'photo' : 'video'}${n + 1}.${m.ext ?? extOf(m, m.url)}`;
    files.push(new AttachmentBuilder(buf, { name }));
    items.push(`attachment://${name}`);
  }
  return { files, items, attached: files.length };
}

/**
 * The quick way to send a repost whose media have links Discord can fetch itself (Instagram's): the card goes out at once with the
 * media as links — nothing is downloaded or uploaded before the reply — and then, in the background, whatever fits the upload limit is
 * downloaded and swapped in as attachments, which last after the links expire (Instagram's do within a day or two). Whatever doesn't fit,
 * such as a video over the limit, stays a link and keeps playing. The card waits a moment for its translation; one that takes longer is
 * added with the files. `persisted` settles when all that is done; nothing has to wait for it. Posts whose media are already downloaded
 * (yt-dlp's) are sent as they are.
 */
export async function sendRepostFast(
  i: ChatInputCommandInteraction, p: RepostPost, links: { open: string; authorUrl?: string },
  o: SendOptions & { attach?: typeof attachWhatFits; /** How long the card waits for its translation (default 2.5 s). */ waitMs?: number } = {},
): Promise<{ persisted: Promise<void> }> {
  if (p.media.some(m => m.data)) { await sendRepost(i, p, links, o); return { persisted: Promise.resolve() }; }
  const translating = translationFor(i, p, o);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const early = await Promise.race([translating, new Promise<undefined>(r => { timer = setTimeout(r, o.waitMs ?? TRANSLATE_WAIT_MS, undefined); })]);
  clearTimeout(timer);
  const items = p.media.slice(0, 10).map(m => m.url);
  await i.editReply(repostCard(p, { files: [], items, skipped: [] }, links, early));
  const persisted = (async () => {
    const [got, tr] = await Promise.all([(o.attach ?? attachWhatFits)(p.media, Math.floor(uploadLimit(i) * 0.95), o.headers).catch(() => null), translating]);
    const late = early === undefined && !!tr;
    if (got?.attached) await i.editReply(repostCard(p, { files: got.files, items: got.items, skipped: [] }, links, tr));
    else if (late) await i.editReply(repostCard(p, { files: [], items, skipped: [] }, links, tr));
  })().catch(() => {}); // the card is already there; a failed upgrade just leaves it as it was
  return { persisted };
}

/** A post yt-dlp fetched (Instagram, Medal): its metadata and the downloaded file as one repost. */
export function ytdlpPost(site: string, color: number, info: PostInfo, media: { data: Buffer; ext: string }, fallbackUrl: string): RepostPost {
  const handle = info.uploader_id?.replace(/^@/, '') || undefined; // YouTube's ids come with their "@"
  return {
    site, color, url: info.webpage_url ?? fallbackUrl,
    author: { name: info.uploader ?? info.channel ?? handle ?? site, handle, url: info.uploader_url ?? info.channel_url },
    text: info.description ?? info.title, createdAt: info.timestamp ? info.timestamp * 1000 : undefined,
    stats: [{ icon: '♡', value: info.like_count }, { icon: '💬', value: info.comment_count }, { icon: '', value: info.view_count, suffix: ' views' }],
    media: [{ type: /^(jpe?g|png|webp)$/.test(media.ext) ? 'image' : 'video', url: fallbackUrl, data: media.data, ext: media.ext }],
  };
}
