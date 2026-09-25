import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  InteractionContextType, SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { cv2Text } from '../../utils/components.js';

const RESPONSES = [
  '🟢 It is certain.', '🟢 It is decidedly so.', '🟢 Without a doubt.',
  '🟢 Yes, definitely.', '🟢 You may rely on it.', '🟢 As I see it, yes.',
  '🟢 Most likely.', '🟢 Outlook good.', '🟢 Yes.', '🟢 Signs point to yes.',
  '🟡 Reply hazy, try again.', '🟡 Ask again later.', '🟡 Better not tell you now.',
  '🟡 Cannot predict now.', '🟡 Concentrate and ask again.',
  '🔴 Don\'t count on it.', '🔴 My reply is no.', '🔴 My sources say no.',
  '🔴 Outlook not so good.', '🔴 Very doubtful.',
];

const EightBall: Command = {
  data: new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the magic 8-ball a question')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addStringOption(o => o.setName('question').setDescription('Your question').setRequired(true)),

  async run(interaction: ChatInputCommandInteraction) {
    const question = interaction.options.getString('question', true);
    const response = RESPONSES[Math.floor(Math.random() * RESPONSES.length)];
    await interaction.reply(cv2Text(`**🎱 Magic 8-Ball**\n**Question:** ${question}\n**Answer:** ${response}`, Colors.DarkPurple));
  },
};

export default EightBall;
