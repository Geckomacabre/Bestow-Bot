import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, FileBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags,
  SectionBuilder, TextDisplayBuilder, ThumbnailBuilder,
} from 'discord.js';
import { spice } from '../utils/spice.js';

/**
 * One look for every card, modelled on Dank Memer's: a "### title" (blue when it is a link) and its text, each field as a bold label
 * over its value, the thumbnail on the right of them, then the image, a small footer and the buttons. Cards about a site keep its colour
 * down the side; cards without one stay plain.
 */

export interface CardOpts {
  /** The card's heading (leave it out for a card that is only text, like a starred message). */
  title?: string;
  /** Makes the title a link. */
  url?: string;
  /** A small line over the title: who or what the card is from. Its icon is the thumbnail when there is no other. */
  author?: { name: string; icon?: string | null; url?: string };
  description?: string | null;
  fields?: ([string, string | number | null | undefined] | null | false)[];
  thumbnail?: string | null;
  image?: string | null;
  /** Files referenced as attachment://name from thumbnail/image/attach. */
  files?: AttachmentBuilder[];
  /** Attached files shown as files (a sound clip plays from here) — a cv2 message hides any its layout doesn't show. */
  attach?: string[];
  color?: number;
  footer?: string;
  /** Shown at the end of the footer as a time in the reader's own timezone (`true` = now). */
  timestamp?: number | Date | true;
  links?: { label: string; url: string; emoji?: string }[];
  /** Buttons or menus of the command's own, under the links. */
  rows?: ActionRowBuilder<any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Text over the card, such as a role or person to ping; pings only reach those `mentions` allows (by default nobody). */
  lead?: string;
  mentions?: { users?: string[]; roles?: string[] };
  /** Only the person who ran the command sees it. */
  ephemeral?: boolean;
}

export const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Discord timestamp from an ISO string / epoch ms / epoch seconds. */
export function when(v: string | number | Date | null | undefined, style: 'R' | 'D' | 'f' | 'd' = 'D'): string {
  if (v == null) return '—';
  const ms = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : new Date(v).getTime();
  return Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:${style}>` : '—';
}

export const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'));

/** 12.3K / 4.5M / 1.2B */
export function compact(n: number | null | undefined): string {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

const isHttp = (u?: string) => !!u && /^(https?:\/\/|attachment:\/\/)/.test(u);

const fieldText = (fields: CardOpts['fields'] = []) => fields
  .filter((f): f is [string, string | number | null | undefined] => !!f && f[1] != null && f[1] !== '')
  .map(([k, v]) => `**${k}**\n${v}`).join('\n');

const stamp = (t: CardOpts['timestamp']) => (t === undefined ? null : `<t:${Math.floor((t === true ? Date.now() : t instanceof Date ? t.getTime() : t < 1e12 ? t * 1000 : t) / 1000)}:f>`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function card(o: CardOpts): any {
  const author = o.author ? `-# ${o.author.url ? `[${trunc(o.author.name, 100)}](${o.author.url})` : trunc(o.author.name, 100)}` : null;
  const title = o.title ? `### ${o.url ? `[${trunc(o.title, 200)}](${o.url})` : trunc(o.title, 200)}` : null;
  // A message's text can't pass 4000 characters in all: the heading and text come first, the fields get what is left.
  const head = spice(trunc([author, title, o.description ? trunc(o.description, 3300) : null].filter(Boolean).join('\n'), 3500), 3500);
  const fieldRoom = Math.max(0, 3500 - head.length);
  const fields = spice(trunc(fieldText(o.fields), fieldRoom), fieldRoom);
  const texts = [head, fields].filter(Boolean).map(t => new TextDisplayBuilder().setContent(t));
  if (!texts.length) texts.push(new TextDisplayBuilder().setContent('\u200b'));

  const c = new ContainerBuilder();
  if (o.color !== undefined) c.setAccentColor(o.color);
  if (o.lead) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(spice(trunc(o.lead, 300), 400)));
  const thumb = isHttp(o.thumbnail ?? undefined) ? o.thumbnail! : isHttp(o.author?.icon ?? undefined) ? o.author!.icon! : null;
  if (thumb) c.addSectionComponents(new SectionBuilder().addTextDisplayComponents(...texts).setThumbnailAccessory(new ThumbnailBuilder().setURL(thumb)));
  else c.addTextDisplayComponents(...texts);
  if (isHttp(o.image ?? undefined)) c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(o.image!)));
  for (const name of o.attach ?? []) c.addFileComponents(new FileBuilder().setURL(`attachment://${name}`));
  const footer = [o.footer ? trunc(o.footer, 300) : null, stamp(o.timestamp)].filter(Boolean).join(' · ');
  if (footer) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footer}`));
  const links = (o.links ?? []).filter(l => isHttp(l.url)).slice(0, 5);
  if (links.length) {
    c.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(links.map(l => {
      const b = new ButtonBuilder().setLabel(trunc(l.label, 80)).setStyle(ButtonStyle.Link).setURL(l.url);
      return l.emoji ? b.setEmoji(l.emoji) : b;
    })));
  }
  for (const r of o.rows ?? []) c.addActionRowComponents(r);
  return {
    flags: o.ephemeral ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral : MessageFlags.IsComponentsV2,
    components: [c], ...(o.files?.length ? { files: o.files } : {}),
    allowedMentions: o.mentions ? { users: o.mentions.users ?? [], roles: o.mentions.roles ?? [] } : { parse: [] },
  };
}

/** A plain list card: bullet lines under a title. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function listCard(title: string, lines: string[], o: Omit<CardOpts, 'title' | 'description' | 'fields'> = {}): any {
  return card({ ...o, title, description: lines.length ? lines.join('\n') : '*Nothing to show.*' });
}
