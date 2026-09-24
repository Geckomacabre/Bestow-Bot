import {
  ApplicationIntegrationType, ChatInputCommandInteraction, InteractionContextType,
  PermissionFlagsBits, SlashCommandBuilder,
} from 'discord.js';
import * as db from '../../utils/db';
import { Command } from '../../interfaces/command';
import { cv2Text, cv2Err } from '../../utils/components.js';
import { sendModCase } from '../../utils/modActions.js';

const Warn: Command = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Member to warn').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      await interaction.reply(cv2Err('❌ You need **Moderate Members** to use this command.')); return;
    }
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason', true);
    await interaction.deferReply();
    if (user.bot) { await interaction.editReply(cv2Text('❌ You cannot warn a bot.')); return; }
    await db.addWarning(guildId, user.id, interaction.user.id, reason);
    const modCase = await db.createModCase(guildId, 'warn', user.id, user.tag, interaction.user.id, interaction.user.tag, reason);
    const cfg = await db.getModConfig(guildId);
    if (cfg.dm_on_punish) {
      await user.send(`You have received a **warning** in **${interaction.guild!.name}**.\nReason: ${reason}`).catch(() => {});
    }
    const warnings = await db.getWarnings(guildId, user.id);
    await sendModCase(interaction, modCase, user, [`**Reason:** ${reason}`, `**Total Warnings:** ${warnings.length}`]);
  },
};

export default Warn;
