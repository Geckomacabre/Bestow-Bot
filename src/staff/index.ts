import { PermissionFlagsBits } from 'discord.js';
import { defineGroup, pickSub } from '../framework/group.js';
import { premiumSubs } from '../subcommands/premium/premium.js';
import type { Command } from '../interfaces/command.js';

/**
 * Owner tools, like Heist's hidden "Staff" commands: registered only in the support server (SUPPORT_GUILD_ID), so they never
 * appear in anyone else's command list. Each handler also checks OWNER_IDS itself.
 */
export const staffCommand: Command = defineGroup({
  name: 'staff', description: 'Bot owner tools', scope: 'guild', permissions: PermissionFlagsBits.Administrator,
  subs: [pickSub(premiumSubs, 'grant', 'premium-grant'), pickSub(premiumSubs, 'revoke', 'premium-revoke')],
});

export const staffGuildId = () => Bun.env.SUPPORT_GUILD_ID || null;
