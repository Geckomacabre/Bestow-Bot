import { InteractionContextType, MessageFlags } from 'discord.js';
import type { Sub } from '../../framework/group';
import { keyMissing } from '../../features/mediaguess';
import { roundBusy, startGame, startInteractiveRound, type MediaType } from '../../utils/mediagame';

/**
 * /community guess — a round of the movie / TV / game / song guessing game, anywhere.
 *  • In a DM with the bot the bot can read your messages, so you just type your guesses.
 *  • Everywhere else (a group DM, a server the bot isn't in…) it can't, so the round is the command's own reply: press **Guess** — or
 *    use `/guess <answer>` — and anyone in the chat can play.
 * Either way the game keeps going, round after round, until someone presses **Stop game**.
 * Servers where an admin gave the game its own channel (`/server guess setup`) run it there with typed guesses and XP, and go on until
 * an admin runs `/server guess stop`.
 */
const guess: Sub = {
  name: 'guess',
  description: 'Play the movie, TV, game or song guessing game right here',
  options: s => s.addStringOption(o => o
    .setName('type')
    .setDescription('What to guess')
    .setRequired(true)
    .addChoices(
      { name: 'Movie', value: 'movie' },
      { name: 'TV Show', value: 'tv' },
      { name: 'Video Game', value: 'game' },
      { name: 'Song', value: 'music' },
    )),

  async run(interaction) {
    const type = interaction.options.getString('type', true) as MediaType;
    const missing = keyMissing(type);
    if (missing) {
      await interaction.reply({ content: missing });
      return;
    }
    if (roundBusy(interaction.channelId)) {
      await interaction.reply({ content: '❌ There\'s already a round going — make a guess, or use **Skip**.' });
      return;
    }

    if (interaction.context !== InteractionContextType.BotDM) {
      // The bot can't read this channel, so the round lives in this reply and is played with buttons and a pop-up box.
      await interaction.deferReply();
      const started = await startInteractiveRound({
        client: interaction.client, channelId: interaction.channelId, userId: interaction.user.id,
        send: payload => interaction.editReply(payload).then(m => ({ id: m.id })),
        edit: (id, payload) => interaction.webhook.editMessage(id, payload),
      }, type).catch(() => false);
      if (!started) await interaction.editReply('😵 I couldn\'t load a round just now — try again in a moment.');
      return;
    }

    await interaction.deferReply();
    const started = await startGame(null, interaction.channelId, type, interaction.client).catch(() => false);
    await interaction.editReply(started ? '✅ Round started — type your guess below! Rounds keep coming until you press ⏹️ **Stop game**.' : '😵 I couldn\'t load a round just now — try again in a moment.');
  },
};

export default guess;
