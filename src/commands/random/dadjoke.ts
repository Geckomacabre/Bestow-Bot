import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  InteractionContextType, SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { cv2Text } from '../../utils/components.js';

const DadJoke: Command = {
  data: new SlashCommandBuilder()
    .setName('dadjoke')
    .setDescription('Get a random dad joke')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM]),

  async run(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    try {
      const res = await fetch('https://icanhazdadjoke.com/', {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      const json: any = await res.json();
      await interaction.editReply(cv2Text(`😂 ${json.joke}`, Colors.Yellow));
    } catch {
      await interaction.editReply(cv2Text('❌ Could not fetch a joke right now.'));
    }
  },
};

export default DadJoke;
