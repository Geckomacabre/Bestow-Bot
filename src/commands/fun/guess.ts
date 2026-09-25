import { MessageFlags } from 'discord.js';
import { defineLeaf, type Sub } from '../../framework/group.js';
import { GUESS_REPLY, followHost } from '../../features/mediaguess/index.js';
import { activeGames, submitGuess } from '../../utils/mediagame.js';

/**
 * /guess <answer> — answer the current round of the guessing game by typing, without a button and a pop-up box.
 * In a group chat (or anywhere the bot can't read messages) this is as close to typing in the chat as Discord allows: the bot only
 * hears slash commands there. Where it can read the chat — a DM with it, or a server it has been added to — you can just type.
 */
const guessSub: Sub = {
  name: 'guess',
  description: 'Answer the current round of the guessing game',
  options: s => s.addStringOption(o => o.setName('answer').setDescription('Your guess').setRequired(true).setMaxLength(100)),
  async run(i) {
    const live = activeGames.get(i.channelId);
    if (live?.guildId) {
      // A server round set up by an admin: guesses are typed in the channel (that's how XP is awarded).
      await i.reply({ content: 'This round is played by typing your answer in the chat.', flags: MessageFlags.Ephemeral });
      return;
    }
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const name = i.member && 'displayName' in i.member ? (i.member.displayName as string) : i.user.globalName ?? i.user.username;
    const result = await submitGuess(i.channelId, i.options.getString('answer', true), { id: i.user.id, name }, i.client, live?.interactive ? followHost(i) : undefined);
    await i.editReply({ content: GUESS_REPLY[result] });
  },
};

export default defineLeaf(guessSub);
