import {
  ApplicationIntegrationType, ChannelType, ChatInputCommandInteraction, Colors,
  InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, TextChannel,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import * as db from '../../utils/db';
import { cv2Text, cv2Err, IS_CV2 } from '../../utils/components.js';
import { postStickyNow, cancelSticky } from '../../features/sticky/index.js';

const Sticky: Command = {
  data: new SlashCommandBuilder()
    .setName('sticky')
    .setDescription('Keep a message pinned to the bottom of a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(s => s.setName('set').setDescription('Set (or replace) the sticky message in a channel')
      .addStringOption(o => o.setName('message').setDescription('The text to keep at the bottom').setRequired(true).setMaxLength(2000))
      .addChannelOption(o => o.setName('channel').setDescription('Channel (defaults to here)').addChannelTypes(ChannelType.GuildText))
      .addBooleanOption(o => o.setName('embed').setDescription('Show it as an embed (default: true)')))
    .addSubcommand(s => s.setName('remove').setDescription('Stop sticking a message in a channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel (defaults to here)').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s.setName('list').setDescription('List every sticky message in this server')) as any,

  async run(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId!;

    if (sub === 'list') {
      const all = await db.getGuildStickies(guildId);
      if (!all.length) { await interaction.reply(cv2Text('No sticky messages set in this server.')); return; }
      const lines = all.map(s => `• <#${s.channel_id}> — ${s.content.length > 60 ? `${s.content.slice(0, 60)}…` : s.content}`);
      await interaction.reply(cv2Text(`**📌 Sticky messages**\n${lines.join('\n')}`, Colors.Blurple));
      return;
    }

    const channel = (interaction.options.getChannel('channel') ?? interaction.channel) as TextChannel;
    if (!channel?.isTextBased?.()) {
      await interaction.reply(cv2Err('❌ That channel can\'t hold a sticky message.')); return;
    }

    if (sub === 'remove') {
      // Read the posted copy's id BEFORE deleting the row, otherwise there's
      // nothing left to tell us which message to clean up.
      const existing = await db.getSticky(channel.id);
      if (!existing) { await interaction.reply(cv2Err(`❌ <#${channel.id}> doesn't have a sticky message.`)); return; }
      await db.removeSticky(channel.id);
      cancelSticky(channel.id);
      if (existing.message_id) await channel.messages.delete(existing.message_id).catch(() => {});
      await interaction.reply(cv2Text(`✅ Sticky message removed from <#${channel.id}>.`, Colors.Green));
      return;
    }

    // set
    const message = interaction.options.getString('message', true);
    const asEmbed = interaction.options.getBoolean('embed') ?? true;

    const me = interaction.guild!.members.me;
    const perms = me ? channel.permissionsFor(me) : null;
    if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply(cv2Err(
        `❌ I need **Send Messages** and **Manage Messages** in <#${channel.id}> — Manage Messages is required so I can delete the old copy when re-posting.`,
      ));
      return;
    }

    await db.setSticky(guildId, channel.id, message, asEmbed, interaction.user.id);
    // Ephemeral confirmation — the sticky itself is about to be posted publicly,
    // so a visible ack would just be noise above it.
    await interaction.reply({
      ...cv2Text(`✅ Sticky message set in <#${channel.id}>. It'll stay at the bottom as people chat.`, Colors.Green),
      flags: IS_CV2 | MessageFlags.Ephemeral,
    });
    await postStickyNow(channel, db);
  },
};

export default Sticky;
