import {
  ApplicationIntegrationType, ChatInputCommandInteraction, InteractionContextType,
  PermissionFlagsBits, SlashCommandBuilder,
} from 'discord.js';
import * as db from '../../utils/db';
import { Command } from '../../interfaces/command';
import { cv2Text, cv2Err } from '../../utils/components.js';
import { parseDuration, sendModCase } from '../../utils/modActions.js';

const Timeout: Command = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a member (max 28 days)')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Member to timeout').setRequired(true))
    .addStringOption(o => o.setName('duration').setDescription('Duration (e.g. 10m, 1h, 7d)').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason')),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      await interaction.reply(cv2Err('❌ You need **Moderate Members** to use this command.')); return;
    }
    const user = interaction.options.getUser('user', true);
    const durationStr = interaction.options.getString('duration', true);
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    await interaction.deferReply();
    const ms = parseDuration(durationStr);
    if (!ms || ms > 28 * 86400000) { await interaction.editReply(cv2Text('❌ Invalid duration. Use formats like `10m`, `1h`, `7d` (max 28d).')); return; }
    const member = await interaction.guild!.members.fetch(user.id).catch(() => null);
    if (!member) { await interaction.editReply(cv2Text('❌ Could not find that member.')); return; }
    if (!member.moderatable) { await interaction.editReply(cv2Text('❌ I cannot timeout this user.')); return; }
    const cfg = await db.getModConfig(guildId);
    if (cfg.dm_on_punish) {
      const until = Math.floor((Date.now() + ms) / 1000);
      await user.send(`You have been **timed out** in **${interaction.guild!.name}** until <t:${until}:R>.\nReason: ${reason}`).catch(() => {});
    }
    await member.timeout(ms, reason);
    const expiresAt = Date.now() + ms;
    const modCase = await db.createModCase(guildId, 'timeout', user.id, user.tag, interaction.user.id, interaction.user.tag, reason, expiresAt);
    await sendModCase(interaction, modCase, user, [`**Duration:** ${durationStr}`, `**Reason:** ${reason}`]);
  },
};

export default Timeout;
