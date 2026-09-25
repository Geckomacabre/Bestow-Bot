import {
  ActionRowBuilder, ApplicationIntegrationType, ButtonBuilder, ButtonStyle,
  ChatInputCommandInteraction, Colors, EmbedBuilder,
  InteractionContextType, SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { fetchAllFreeGames, fetchEpicUpcomingGames } from '../../features/freegames/index.js';
import type { FreeGame } from '../../features/freegames/index.js';

function buildGameEmbeds(games: FreeGame[], upcoming = false): EmbedBuilder[] {
  return games.slice(0, 10).map(game => {
    const embed = new EmbedBuilder()
      .setColor(upcoming ? Colors.Purple : Colors.Gold)
      .setTitle(game.title)
      .setURL(game.url)
      .setDescription(game.description ?? (upcoming ? `Coming free to **${game.platform}**!` : `Free on **${game.platform}**!`))
      .setFooter({ text: game.platform });

    if (game.image) embed.setThumbnail(game.image);

    const fields: { name: string; value: string; inline: boolean }[] = [];
    if (game.originalPrice) fields.push({ name: 'Value', value: `~~${game.originalPrice}~~  →  **FREE**`, inline: true });
    if (game.endDate) {
      const ts = Math.floor(new Date(game.endDate).getTime() / 1000);
      fields.push({ name: upcoming ? 'Free Starting' : 'Free Until', value: `<t:${ts}:R> (<t:${ts}:D>)`, inline: true });
    }
    if (fields.length) embed.addFields(fields);
    return embed;
  });
}

function buildClaimRows(games: FreeGame[]): ActionRowBuilder<ButtonBuilder>[] {
  const buttons = games.slice(0, 10).map(game =>
    new ButtonBuilder()
      .setLabel(game.title.slice(0, 40))
      .setStyle(ButtonStyle.Link)
      .setURL(game.url)
      .setEmoji('🎮')
  );
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
  }
  return rows.slice(0, 5);
}

const FreeGames: Command = {
  data: new SlashCommandBuilder()
    .setName('freegames')
    .setDescription('Check free games')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(s => s.setName('now').setDescription('Games that are free right now (Epic, Steam, GOG)'))
    .addSubcommand(s => s.setName('upcoming').setDescription('Upcoming free games on Epic Games Store')) as any,

  async run(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply();

    if (sub === 'upcoming') {
      const games = await fetchEpicUpcomingGames();
      if (!games.length) {
        await interaction.editReply({ embeds: [
          new EmbedBuilder()
            .setColor(Colors.Grey)
            .setTitle('🎮 Upcoming Free Games')
            .setDescription('No upcoming free games announced yet. Check back later!'),
        ]});
        return;
      }
      await interaction.editReply({
        content: `🗓️ **${games.length} upcoming free game${games.length !== 1 ? 's' : ''} on Epic:**`,
        embeds: buildGameEmbeds(games, true),
        components: buildClaimRows(games),
      });
      return;
    }

    // sub === 'now'
    const games = await fetchAllFreeGames();
    if (!games.length) {
      await interaction.editReply({ embeds: [
        new EmbedBuilder()
          .setColor(Colors.Grey)
          .setTitle('🎮 Free Games')
          .setDescription('No free games found right now. Check back later!'),
      ]});
      return;
    }
    await interaction.editReply({
      content: `🎮 **${games.length} free game${games.length !== 1 ? 's' : ''} available right now:**`,
      embeds: buildGameEmbeds(games),
      components: buildClaimRows(games),
    });
  },
};

export default FreeGames;
