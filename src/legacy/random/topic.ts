import {
  ApplicationIntegrationType, ChatInputCommandInteraction,
  InteractionContextType, SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { cv2Text } from '../../utils/components.js';

const TOPICS = [
  'What\'s the most underrated movie of the last decade?',
  'If you could have any superpower, what would it be and why?',
  'What\'s the best advice you\'ve ever received?',
  'What would you do if you won the lottery?',
  'What technology from sci-fi do you wish existed today?',
  'If you could travel to any time period, where would you go?',
  'What\'s a skill you\'ve always wanted to learn?',
  'What\'s the most interesting place you\'ve ever visited?',
  'If you could have dinner with any historical figure, who would it be?',
  'What\'s your favourite book and why should others read it?',
  'What hobby do you think everyone should try at least once?',
  'What\'s a controversial opinion you\'re willing to defend?',
  'If you could redesign one thing about how society works, what would it be?',
  'What\'s the most valuable lesson you\'ve learned from a failure?',
  'If you had to live in a different country for a year, where would you choose?',
  'What game — board, video, or otherwise — do you think is the most fun?',
  'If you could only listen to one artist for the rest of your life, who would it be?',
  'What\'s the most impressive thing a human has ever built?',
  'What\'s a common misconception people have?',
];

const Topic: Command = {
  data: new SlashCommandBuilder()
    .setName('topic')
    .setDescription('Get a random conversation topic')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM]),

  async run(interaction: ChatInputCommandInteraction) {
    const topic = TOPICS[Math.floor(Math.random() * TOPICS.length)];
    await interaction.reply(cv2Text(`💬 **Topic:** ${topic}`));
  },
};

export default Topic;
