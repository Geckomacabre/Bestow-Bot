import {
  ApplicationIntegrationType, ChatInputCommandInteraction,
  InteractionContextType, MessageFlags, PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import * as db from '../../utils/db';
import { Command } from '../../interfaces/command';

const RepConfig: Command = {
  data: new SlashCommandBuilder()
    .setName('repconfig')
    .setDescription('Reputation admin commands (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(sub => sub
      .setName('take')
      .setDescription('Take a reputation point from a user')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    ),

  async run(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    const target = interaction.options.getUser('user', true);
    const newPoints = await db.adjustReputation(interaction.guildId!, target.id, -1);
    await interaction.editReply(`✅ Took 1 rep from **${target.username}**. They now have **${newPoints}** rep.`);
  },
};

export default RepConfig;
