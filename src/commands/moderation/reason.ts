import {
  ApplicationIntegrationType, ChatInputCommandInteraction, InteractionContextType,
  PermissionFlagsBits, SlashCommandBuilder,
} from 'discord.js';
import * as db from '../../utils/db';
import { Command } from '../../interfaces/command';
import { cv2Err } from '../../utils/components.js';

const Reason: Command = {
  data: new SlashCommandBuilder()
    .setName('reason')
    .setDescription('Edit the reason for a mod case')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addIntegerOption(o => o.setName('case').setDescription('Case number').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('New reason').setRequired(true)),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      await interaction.reply(cv2Err('❌ You need **Moderate Members** to edit case reasons.')); return;
    }
    const caseNum = interaction.options.getInteger('case', true);
    const reason = interaction.options.getString('reason', true);
    const modCase = await db.getModCase(guildId, caseNum);
    if (!modCase) { await interaction.reply(cv2Err(`❌ Case #${caseNum} not found.`)); return; }
    await db.updateModCaseReason(guildId, caseNum, reason);
    await interaction.reply(cv2Err(`✅ Updated reason for case #${caseNum}.`));
  },
};

export default Reason;
