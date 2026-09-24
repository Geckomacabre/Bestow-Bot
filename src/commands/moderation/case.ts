import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors, ContainerBuilder,
  InteractionContextType, PermissionFlagsBits, SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import * as db from '../../utils/db';
import { Command } from '../../interfaces/command';
import { cv2Err, IS_CV2 } from '../../utils/components.js';
import { TYPE_COLORS, capitalize } from '../../utils/modActions.js';

const CaseCmd: Command = {
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('View a mod case')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addIntegerOption(o => o.setName('number').setDescription('Case number').setRequired(true)),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      await interaction.reply(cv2Err('❌ You need **Moderate Members** to view mod cases.')); return;
    }
    const caseNum = interaction.options.getInteger('number', true);
    const modCase = await db.getModCase(guildId, caseNum);
    if (!modCase) { await interaction.reply(cv2Err(`❌ Case #${caseNum} not found.`)); return; }
    const color = TYPE_COLORS[modCase.type] ?? Colors.Grey;
    const container = new ContainerBuilder().setAccentColor(color)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        [
          `**Case #${modCase.case_num} — ${capitalize(modCase.type)}**`,
          `**User:** ${modCase.user_tag} (${modCase.user_id})`,
          `**Moderator:** ${modCase.mod_tag} (${modCase.mod_id})`,
          `**Reason:** ${modCase.reason ?? 'No reason provided'}`,
          `**Date:** <t:${Math.floor(modCase.created_at / 1000)}:F>`,
          ...(modCase.expires_at ? [`**Expires:** <t:${Math.floor(modCase.expires_at / 1000)}:R>`] : []),
        ].join('\n')
      ));
    await interaction.reply({ flags: IS_CV2, components: [container] });
  },
};

export default CaseCmd;
