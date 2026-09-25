import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  InteractionContextType, SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { cv2Text } from '../../utils/components.js';

const WYR_QUESTIONS = [
  ['Always be 10 minutes late', 'Always be 20 minutes early'],
  ['Lose all your money', 'Lose all your photos and memories'],
  ['Be able to fly', 'Be able to be invisible'],
  ['Never be able to use your phone again', 'Never be able to watch TV again'],
  ['Live without music', 'Live without movies'],
  ['Always be too hot', 'Always be too cold'],
  ['Be famous but hated', 'Be unknown but loved'],
  ['Have unlimited money but no friends', 'Have amazing friends but always be broke'],
  ['Always have to speak in rhymes', 'Always have to sing what you say'],
  ['Be able to speak every language', 'Be able to play every instrument'],
  ['Never eat sweets again', 'Never eat savoury food again'],
  ['Go back in time 100 years', 'Travel to the future 100 years'],
  ['Have a photographic memory', 'Have an IQ of 200'],
  ['Always know when people are lying', 'Always get away with lying'],
  ['Be the funniest person in the room', 'Be the smartest person in the room'],
];

const WouldYouRather: Command = {
  data: new SlashCommandBuilder()
    .setName('wouldyourather')
    .setDescription('Get a would you rather question')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM]),

  async run(interaction: ChatInputCommandInteraction) {
    const [a, b] = WYR_QUESTIONS[Math.floor(Math.random() * WYR_QUESTIONS.length)];
    await interaction.reply(cv2Text(`**🤔 Would You Rather...**\n\n🅰️ **Option A:** ${a}\n🅱️ **Option B:** ${b}`, Colors.Purple));
    const msg = await interaction.fetchReply();
    await msg.react('🅰️').catch(() => {});
    await msg.react('🅱️').catch(() => {});
  },
};

export default WouldYouRather;
