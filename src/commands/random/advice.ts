import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  InteractionContextType, SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { cv2Text } from '../../utils/components.js';

const Advice: Command = {
  data: new SlashCommandBuilder()
    .setName('advice')
    .setDescription('Get a random piece of advice')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM]),

  async run(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    try {
      const res = await fetch('https://api.adviceslip.com/advice', { signal: AbortSignal.timeout(8000) });
      const json: any = await res.json();
      await interaction.editReply(cv2Text(`💡 *"${json.slip.advice}"*`, Colors.Gold));
    } catch {
      await interaction.editReply(cv2Text('❌ Could not fetch advice right now.'));
    }
  },
};

export default Advice;
