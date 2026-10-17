import {
  ApplicationIntegrationType, ChatInputCommandInteraction,
  InteractionContextType, SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { randomWouldYouRather, wouldYouRatherPanel } from '../../groupchat/party.js';

/** Everyone votes with 🅰️ / 🅱️ buttons (reactions can't be added in group chats, where the bot isn't a member). */
const WouldYouRather: Command = {
  data: new SlashCommandBuilder()
    .setName('wouldyourather')
    .setDescription('Get a would you rather question')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM]),

  async run(interaction: ChatInputCommandInteraction) {
    await interaction.reply(await wouldYouRatherPanel(randomWouldYouRather()));
  },
};

export default WouldYouRather;
