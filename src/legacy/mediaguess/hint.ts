import {
  ApplicationIntegrationType, ChatInputCommandInteraction,
  InteractionContextType, SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { requestHint } from '../../utils/mediagame';

const Hint: Command = {
  data: new SlashCommandBuilder()
    .setName('hint')
    .setDescription('Reveal the next clue for the guessing game round in this channel')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM]),

  async run(interaction: ChatInputCommandInteraction) {
    // Deferred and public — hints are shared with the whole channel. The
    // defer is needed because music's "Extended Snippet" hint downloads and
    // trims audio, which can take longer than Discord's 3-second interaction window.
    await interaction.deferReply();
    const payload = await requestHint(interaction.channelId, interaction.user.id);
    if (!payload) {
      await interaction.editReply({ content: '❌ There is no active guessing game in this channel.' });
      return;
    }
    await interaction.editReply(payload as any);
  },
};

export default Hint;
