import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, TextDisplayBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { premiumConfigured, premiumOf, premiumSku } from './index.js';

/**
 * Commands marked `premium: true` (the ✨ ones) need Premium — but only once Premium is actually on sale.
 * Until a subscription SKU is configured there is nothing to buy, so they stay open to everyone; setting PREMIUM_SKU_ID turns the gate on.
 */
export const gateActive = (): boolean => premiumConfigured();

export const PREMIUM_MARK = '✨ ';

/** Replies with the "this needs Premium" card and returns true if the person is blocked; returns false (having sent nothing) if they may proceed. */
export async function premiumWall(i: ChatInputCommandInteraction): Promise<boolean> {
  if (!gateActive()) return false;
  if ((await premiumOf(i)).premium) return false;
  const card = new ContainerBuilder().setAccentColor(0xf1c40f).addTextDisplayComponents(new TextDisplayBuilder().setContent(
    '## ✨ Premium command\nThis one is part of **Bestow Premium**. Get it once and it works on every server, DM and group chat you use Bestow in. Discord handles the payment.'));
  card.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Premium).setSKUId(premiumSku()!)));
  await i.reply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [card] });
  return true;
}
