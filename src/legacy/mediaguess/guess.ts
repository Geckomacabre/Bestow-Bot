import { InteractionContextType, MessageFlags } from 'discord.js';
import type { Sub } from '../../framework/group';
import { keyMissing } from '../../features/mediaguess';
import { roundBusy, startGame, type MediaType } from '../../utils/mediagame';

/**
 * /community guess — a solo round of the movie / TV / game / song guessing game in your DMs with the bot. Servers run the game in
 * a channel an admin picks (`/server guess setup`); the bot can only read guesses in a DM it's part of, so this is DM-only.
 */
const guess: Sub = {
  name: 'guess',
  description: 'Play the movie, TV, game or song guessing game in your DMs with me',
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
    if (interaction.context !== InteractionContextType.BotDM) {
      const where = interaction.inGuild() ? ' In servers, an admin can give the game its own channel with `/server guess setup`.' : '';
      await interaction.reply({ content: `🎯 Solo guessing rounds work in your DMs with me — open a DM and run \`/community guess\` there.${where}`, flags: MessageFlags.Ephemeral });
      return;
    }
    const type = interaction.options.getString('type', true) as MediaType;
    const missing = keyMissing(type);
    if (missing) {
      await interaction.reply({ content: missing, flags: MessageFlags.Ephemeral });
      return;
    }
    if (roundBusy(interaction.channelId)) {
      await interaction.reply({ content: '❌ There\'s already a round going — make a guess, or use **Skip**.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const started = await startGame(null, interaction.channelId, type, interaction.client).catch(() => false);
    await interaction.editReply(started ? '✅ Round started — type your guess below!' : '😵 I couldn\'t load a round just now — try again in a moment.');
  },
};

export default guess;
