import {
  ApplicationIntegrationType, ChatInputCommandInteraction,
  InteractionContextType, MessageFlags, SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { castVoteSkip } from '../../utils/mediagame';

const VoteSkip: Command = {
  data: new SlashCommandBuilder()
    .setName('voteskip')
    .setDescription('Vote to skip the current guessing game (2 votes needed, available 5 min into the round)')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild]),

  async run(interaction: ChatInputCommandInteraction) {
    const { content, ephemeral } = await castVoteSkip(interaction.channelId, interaction.user.id, interaction.client);
    await interaction.reply({ content, flags: ephemeral ? MessageFlags.Ephemeral : undefined });
  },
};

export default VoteSkip;
