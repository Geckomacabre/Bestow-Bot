import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, TextDisplayBuilder, type MessageActionRowComponentBuilder } from 'discord.js';
import { trunc } from '../lookups/card.js';
import { cv2Err } from '../utils/components.js';
import type { ComponentInteraction } from '../framework/router.js';

/**
 * The look of every group-chat panel: a coloured card with a title, the body, a small footer and its buttons inside the card.
 * Panels are the command's own reply, and every button press edits them in place — which works in group chats, where the bot
 * can't post or edit messages by itself.
 */

export interface PanelOpts {
  title: string;
  body: string;
  footer?: string;
  color?: number;
  rows?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function panel(o: PanelOpts): any {
  const c = new ContainerBuilder();
  if (o.color !== undefined) c.setAccentColor(o.color);
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(trunc(`## ${o.title}\n${o.body}`, 3600)));
  if (o.footer) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${trunc(o.footer, 300)}`));
  for (const r of o.rows ?? []) c.addActionRowComponents(r);
  return { flags: MessageFlags.IsComponentsV2, components: [c], allowedMentions: { parse: [] } };
}

export const button = (id: string, label: string, style: ButtonStyle = ButtonStyle.Secondary, emoji?: string) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
};

export const row = (...items: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...items);

/** A private note (only the person who pressed or ran the command sees it). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function privately(text: string, color?: number): any {
  const c = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  if (color !== undefined) c.setAccentColor(color);
  return { flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [c], allowedMentions: { parse: [] } };
}

/** A private "that didn't work" note for the person who pressed. */
export async function oops(i: ComponentInteraction, text: string): Promise<void> {
  await i.reply(cv2Err(`❌ ${text}`));
}

/** Rewrites the panel a button (or a pop-up opened from one) belongs to; a pop-up from a slash command gets a fresh reply. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function repaint(i: ComponentInteraction, payload: any): Promise<void> {
  if (i.isModalSubmit()) {
    if (i.isFromMessage()) await i.update(payload); else await i.reply(payload);
    return;
  }
  await i.update(payload);
}

export const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
};

/** Days from today (UTC) until the next `month`/`day`; 0 = today. Feb 29 falls on Mar 1 in other years. */
export function daysUntil(month: number, day: number, now = Date.now()): number {
  const t = new Date(now);
  const today = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
  let next = Date.UTC(t.getUTCFullYear(), month - 1, day);
  if (next < today) next = Date.UTC(t.getUTCFullYear() + 1, month - 1, day);
  return Math.round((next - today) / 86_400_000);
}
