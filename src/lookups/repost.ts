import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, SectionBuilder,
  SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder, type ChatInputCommandInteraction,
} from 'discord.js';
import { getBufferPublic } from '../framework/http.js';
import { uploadLimit } from '../framework/media.js';
import type { PostInfo } from '../media/download.js';
import { trunc } from './card.js';

/**
 * The Heist-style repost card shared by /x repost, /tiktok repost, /instagram repost and /medaltv repost:
 *   name ☑️ / @handle • 18 hours ago   [avatar]
 *   post text
 *   [the video or photos, playable inline]
 *   ♡ 906 · 💬 105 · 🔖 66 · 🔁 23 · 24k views
 *   [Open on X] [Author]
 * Media is downloaded and attached so it plays inside Discord (CDN links from these sites expire or refuse hotlinking).
 */

export interface RepostMedia { type: 'video' | 'image' | 'gif'; url: string; thumb?: string; /** Already downloaded (e.g. by yt-dlp). */ data?: Buffer; ext?: string }
export interface RepostPost {
  site: string;
  color: number;
  author: { name: string; handle?: string; avatar?: string; url?: string; verified?: boolean };
  text?: string;
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

/**
 * Downloads up to 10 items within the upload limit; anything that doesn't fit stays a link. The files come down a few at a time, and
 * are then taken in order for as long as the total fits, so the result is the same as fetching them one by one, only faster.
 */
export async function fetchMedia(media: RepostMedia[], limit: number, headers?: Record<string, string>): Promise<{ files: AttachmentBuilder[]; items: string[]; skipped: RepostMedia[] }> {
  const wanted = media.slice(0, 10);
  const bufs: (Buffer | null)[] = new Array(wanted.length).fill(null);
  let next = 0;
  const worker = async () => {
    for (let n = next++; n < wanted.length; n = next++) {
      const m = wanted[n]!;
      try { bufs[n] = m.data ?? await getBufferPublic(m.url, { maxBytes: Math.max(1, limit), timeoutMs: 45_000, headers }); } catch { /* left null: it stays a link */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_DOWNLOADS, wanted.length) }, worker));

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

export function repostCard(p: RepostPost, attached: { files: AttachmentBuilder[]; items: string[]; skipped: RepostMedia[] }, links: { open: string; authorUrl?: string }) {
  const head = [
    `### ${trunc(p.author.name, 80)}${p.author.verified ? ` ${VERIFIED}` : ''}`,
    [p.author.handle ? `@${p.author.handle}` : null, p.createdAt ? `<t:${Math.floor(p.createdAt / 1000)}:R>` : null].filter(Boolean).join(' • '),
  ].filter(Boolean).join('\n');
  const c = new ContainerBuilder().setAccentColor(p.color);
  if (p.author.avatar) c.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(head)).setThumbnailAccessory(new ThumbnailBuilder().setURL(p.author.avatar)));
  else c.addTextDisplayComponents(new TextDisplayBuilder().setContent(head));
  if (p.text?.trim()) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(trunc(p.text.trim(), 1800)));
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

/** Fetch the media and send the card as the interaction's reply (the interaction must already be deferred). */
export async function sendRepost(i: ChatInputCommandInteraction, p: RepostPost, links: { open: string; authorUrl?: string }, headers?: Record<string, string>) {
  const attached = await fetchMedia(p.media, Math.floor(uploadLimit(i) * 0.95), headers);
  await i.editReply(repostCard(p, attached, links));
}

/** A post yt-dlp fetched (Instagram, Medal): its metadata and the downloaded file as one repost. */
export function ytdlpPost(site: string, color: number, info: PostInfo, media: { data: Buffer; ext: string }, fallbackUrl: string): RepostPost {
  const handle = info.uploader_id ?? undefined;
  return {
    site, color, url: info.webpage_url ?? fallbackUrl,
    author: { name: info.uploader ?? info.channel ?? handle ?? site, handle, url: info.uploader_url ?? info.channel_url },
    text: info.description ?? info.title, createdAt: info.timestamp ? info.timestamp * 1000 : undefined,
    stats: [{ icon: '♡', value: info.like_count }, { icon: '💬', value: info.comment_count }, { icon: '', value: info.view_count, suffix: ' views' }],
    media: [{ type: /^(jpe?g|png|webp)$/.test(media.ext) ? 'image' : 'video', url: fallbackUrl, data: media.data, ext: media.ext }],
  };
}
