import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags,
  SectionBuilder, TextDisplayBuilder, ThumbnailBuilder,
} from 'discord.js';

/** One consistent look for every lookup command: a coloured container with title, fields, thumbnail, image and link buttons. */

export interface CardOpts {
  title: string;
  /** Makes the title a link. */
  url?: string;
  description?: string;
  fields?: ([string, string | number | null | undefined] | null | false)[];
  thumbnail?: string;
  image?: string;
  /** Files referenced as attachment://name from thumbnail/image. */
  files?: AttachmentBuilder[];
  color?: number;
  footer?: string;
  links?: { label: string; url: string }[];
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function card(o: CardOpts): any {
  const head = `## ${o.url ? `[${trunc(o.title, 200)}](${o.url})` : trunc(o.title, 200)}`;
  const body = [
    o.description ? trunc(o.description, 3300) : null,
    ...(o.fields ?? []).filter((f): f is [string, string | number | null | undefined] => !!f && f[1] != null && f[1] !== '').map(([k, v]) => `**${k}:** ${v}`),
  ].filter(Boolean).join('\n');
  const text = trunc(`${head}${body ? `\n${body}` : ''}`, 3500);

  const c = new ContainerBuilder();
  if (o.color !== undefined) c.setAccentColor(o.color);
  if (isHttp(o.thumbnail)) {
    c.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text)).setThumbnailAccessory(new ThumbnailBuilder().setURL(o.thumbnail!)));
  } else {
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  }
  if (isHttp(o.image)) c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(o.image!)));
  if (o.footer) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${trunc(o.footer, 300)}`));
  const links = (o.links ?? []).filter(l => isHttp(l.url)).slice(0, 5);
  if (links.length) {
    c.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      links.map(l => new ButtonBuilder().setLabel(trunc(l.label, 80)).setStyle(ButtonStyle.Link).setURL(l.url))));
  }
  return { flags: MessageFlags.IsComponentsV2, components: [c], ...(o.files?.length ? { files: o.files } : {}), allowedMentions: { parse: [] } };
}

/** A plain list card: bullet lines under a title. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function listCard(title: string, lines: string[], o: Omit<CardOpts, 'title' | 'description' | 'fields'> = {}): any {
  return card({ ...o, title, description: lines.length ? lines.join('\n') : '*Nothing to show.*' });
}
