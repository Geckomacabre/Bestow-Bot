import {
  ApplicationIntegrationType, ChatInputCommandInteraction, InteractionContextType,
  PermissionFlagsBits, SlashCommandBuilder,
} from 'discord.js';
import * as db from '../../utils/db';
import { Command } from '../../interfaces/command';
import { cv2Text, cv2Err } from '../../utils/components.js';
import { parseDuration, sendModCase } from '../../utils/modActions.js';

const Ban: Command = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName('user').setDescription('User to ban').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for the ban'))
    .addIntegerOption(o => o.setName('days').setDescription('Days of messages to delete (0-7)').setMinValue(0).setMaxValue(7))
    .addStringOption(o => o.setName('duration').setDescription('Temp ban duration (e.g. 1d, 12h). Leave blank for permanent.')),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
      await interaction.reply(cv2Err('❌ You need **Ban Members** to use this command.')); return;
    }
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    const days = interaction.options.getInteger('days') ?? 0;
    const durationStr = interaction.options.getString('duration');
    await interaction.deferReply();

    let expiresAt: number | null = null;
    if (durationStr) {
      const ms = parseDuration(durationStr);
      if (!ms) { await interaction.editReply(cv2Text('❌ Invalid duration. Use formats like `1d`, `12h`, `30m`.')); return; }
      expiresAt = Date.now() + ms;
    }
    const member = await interaction.guild!.members.fetch(user.id).catch(() => null);
    if (member) {
      if (!member.bannable) { await interaction.editReply(cv2Text('❌ I cannot ban this user.')); return; }
      if (member.roles.highest.position >= interaction.guild!.members.me!.roles.highest.position) {
        await interaction.editReply(cv2Text('❌ That user has a higher or equal role than me.')); return;
      }
    }
    const cfg = await db.getModConfig(guildId);
    if (cfg.dm_on_punish) {
      await user.send(`You have been **banned** from **${interaction.guild!.name}**.\nReason: ${reason}${expiresAt ? `\nExpires: <t:${Math.floor(expiresAt / 1000)}:R>` : ''}`).catch(() => {});
    }
    try { await interaction.guild!.members.ban(user.id, { reason, deleteMessageSeconds: days * 86400 }); }
    catch { await interaction.editReply(cv2Text('❌ Failed to ban user. Check my permissions.')); return; }
    const modCase = await db.createModCase(guildId, 'ban', user.id, user.tag, interaction.user.id, interaction.user.tag, reason, expiresAt);
    if (expiresAt) await db.createScheduledTask('unban', expiresAt, { guild_id: guildId, user_id: user.id, data: { caseNum: modCase.case_num } });
    await sendModCase(interaction, modCase, user, [`**Reason:** ${reason}`, ...(days > 0 ? [`**Messages Deleted:** ${days}d`] : [])]);
  },
};

export default Ban;
