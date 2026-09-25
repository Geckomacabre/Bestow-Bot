import { Colors } from 'discord.js';
import { hleaf } from '../../framework/heist.js';
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

export default hleaf('8ball', async i => {
  const question = i.options.getString('question', true);
  const response = RESPONSES[Math.floor(Math.random() * RESPONSES.length)];
  await i.reply({ ...cv2Text(`**🎱 Magic 8-Ball**\n**Question:** ${question}\n**Answer:** ${response}`, Colors.DarkPurple), allowedMentions: { parse: [] } });
}, { tweaks: { question: { maxLength: 300 } } });
