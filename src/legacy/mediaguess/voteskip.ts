import {
  ApplicationIntegrationType, ChatInputCommandInteraction,
  InteractionContextType, MessageFlags, SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { castVoteSkip } from '../../utils/mediagame';

const VoteSkip: Command = {
  data: new SlashCommandBuilder()
    .setName('voteskip')
    .setDescription('Vote to skip the guessing game round (2 votes, after 5 min; instant in DMs)')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM]),

  async run(interaction: ChatInputCommandInteraction) {
    const { content, ephemeral } = await castVoteSkip(interaction.channelId, interaction.user.id, interaction.client);
    await interaction.reply({ content, flags: ephemeral ? MessageFlags.Ephemeral : undefined });
  },
};

export default VoteSkip;
