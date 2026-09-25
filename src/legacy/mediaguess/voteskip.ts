import {
  ApplicationIntegrationType, ChatInputCommandInteraction,
  InteractionContextType, SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { followHost } from '../../features/mediaguess';
import { activeGames, castVoteSkip } from '../../utils/mediagame';

const VoteSkip: Command = {
  data: new SlashCommandBuilder()
    .setName('voteskip')
    .setDescription('Skip the guessing game round (the starter alone, or 2 votes; servers wait 5 min)')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),

  async run(interaction: ChatInputCommandInteraction) {
    const live = activeGames.get(interaction.channelId);
    // Revealing a song fetches its full clip, so acknowledge first; a game run through interactions goes on through this reply.
    await interaction.deferReply();
    const { content } = await castVoteSkip(interaction.channelId, interaction.user.id, interaction.client, live?.interactive ? followHost(interaction) : undefined);
    await interaction.editReply({ content });
  },
};

export default VoteSkip;
