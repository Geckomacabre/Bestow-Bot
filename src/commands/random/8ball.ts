import path from 'node:path';
import { AttachmentBuilder, ContainerBuilder, escapeMarkdown, MessageFlags, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder } from 'discord.js';
import { hleaf } from '../../framework/heist.js';

const RESPONSES = [
  'It is certain.', 'It is decidedly so.', 'Without a doubt.',
  'Yes, definitely.', 'You may rely on it.', 'As I see it, yes.',
  'Most likely.', 'Outlook good.', 'Yes.', 'Signs point to yes.',
  'Reply hazy, try again.', 'Ask again later.', 'Better not tell you now.',
  'Cannot predict now.', 'Concentrate and ask again.',
  'Don\'t count on it.', 'My reply is no.', 'My sources say no.',
  'Outlook not so good.', 'Very doubtful.',
];

/** The ball beside the answer: drawn once and kept with the bot, so nothing is fetched to answer. */
const BALL = path.resolve(import.meta.dir, '../../assets/images/8ball.png');

/**
 * The answer card: the title, then Question and Answer each in bold over its text, and the ball on the right. The question is
 * escaped so it shows exactly as typed (a "#" or "-" at its start doesn't turn it into a heading or a list).
 */
export function eightBallCard(question: string, answer: string) {
  const asked = escapeMarkdown(question, { heading: true, bulletedList: true, numberedList: true, maskedLink: true });
  const text = `### [Magic 8ball](https://en.wikipedia.org/wiki/Magic_8_Ball)\n**Question**\n${asked}\n**Answer**\n${answer}`;
  const card = new ContainerBuilder().addSectionComponents(
    new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text)).setThumbnailAccessory(new ThumbnailBuilder().setURL('attachment://8ball.png')),
  );
  return { flags: MessageFlags.IsComponentsV2 as const, components: [card], files: [new AttachmentBuilder(BALL, { name: '8ball.png' })], allowedMentions: { parse: [] as never[] } };
}

export default hleaf('8ball', async i => {
  const answer = RESPONSES[Math.floor(Math.random() * RESPONSES.length)]!;
  await i.reply(eightBallCard(i.options.getString('question', true), answer));
}, { tweaks: { question: { maxLength: 300 } } });
