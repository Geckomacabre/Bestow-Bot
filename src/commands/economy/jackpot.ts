import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, TextChannel,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import * as db from '../../utils/db';
import { cv2Text, cv2Err, IS_CV2 } from '../../utils/components.js';
import { formatJackpotMessage } from '../../utils/gamble.js';
import { postStickyNow } from '../../features/sticky/index.js';

const Jackpot: Command = {
  data: new SlashCommandBuilder()
    .setName('jackpot')
    .setDescription('See the current progressive jackpot pool')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    // An option rather than a subcommand: Discord won't let a command be both
    // bare-invokable and have subcommands, and plain /jackpot should keep working.
    .addBooleanOption(o => o.setName('sticky')
      .setDescription('Pin a live-updating jackpot message to this channel (Manage Messages)')),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    const wantSticky = interaction.options.getBoolean('sticky') ?? false;

    if (!wantSticky) {
      await interaction.reply(cv2Text(await formatJackpotMessage(guildId), Colors.Gold));
      return;
    }

    // ── Sticky mode ───────────────────────────────────────────────────────────
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply(cv2Err('❌ You need **Manage Messages** to stick the jackpot to a channel.'));
      return;
    }

    const channel = interaction.channel as TextChannel;
    if (!channel?.isTextBased?.() || channel.isDMBased?.()) {
      await interaction.reply(cv2Err('❌ That channel can\'t hold a sticky message.'));
      return;
    }

    const me = interaction.guild!.members.me;
    const botPerms = me ? channel.permissionsFor(me) : null;
    if (!botPerms?.has(PermissionFlagsBits.SendMessages) || !botPerms.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply(cv2Err(
        `❌ I need **Send Messages** and **Manage Messages** in <#${channel.id}> — Manage Messages is required so I can delete the old copy when re-posting.`,
      ));
      return;
    }

    // content is ignored for 'jackpot' stickies (it's rebuilt live), but store a
    // readable placeholder so /sticky list shows something sensible.
    await db.setSticky(guildId, channel.id, '🎰 Progressive Jackpot (live)', true, interaction.user.id, 'jackpot');

    await interaction.reply({
      ...cv2Text(
        `✅ Jackpot pinned to <#${channel.id}>. It'll stay at the bottom and **refresh the amount every time it re-posts**, so it never shows a stale figure.\n` +
        `Remove it with \`/sticky remove\`.`,
        Colors.Green,
      ),
      flags: IS_CV2 | MessageFlags.Ephemeral,
    });
    await postStickyNow(channel, db);
  },
};

export default Jackpot;
