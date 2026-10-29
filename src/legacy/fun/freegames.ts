import {
  ApplicationIntegrationType, ChatInputCommandInteraction, ContainerBuilder, InteractionContextType, MessageFlags, SectionBuilder,
  SlashCommandBuilder, TextDisplayBuilder, ThumbnailBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { card } from '../../lookups/card.js';
import { fetchAllFreeGames, fetchEpicUpcomingGames } from '../../features/freegames/index.js';
import type { FreeGame } from '../../features/freegames/index.js';

/**
 * Up to ten free games in one card: each one's title (a link to its store page), where, its price and until when, with its picture
 * beside it. Three components a game keeps a list of ten under the 40 a message may hold.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function gameList(games: FreeGame[], upcoming = false): any {
  const c = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `### ${upcoming ? '🗓️ Coming free on Epic' : '🎮 Free right now'}\n-# ${games.length} game${games.length === 1 ? '' : 's'}${games.length > 10 ? ' · the first 10' : ''}`));
  for (const g of games.slice(0, 10)) {
    const ts = g.endDate ? Math.floor(new Date(g.endDate).getTime() / 1000) : null;
    const text = new TextDisplayBuilder().setContent([
      `**[${g.title.slice(0, 100)}](${g.url})**`,
      [g.platform, g.originalPrice ? `~~${g.originalPrice}~~ **Free**` : null, ts ? `${upcoming ? 'from' : 'until'} <t:${ts}:R>` : null].filter(Boolean).join(' · '),
    ].join('\n'));
    if (g.image) c.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text).setThumbnailAccessory(new ThumbnailBuilder().setURL(g.image)));
    else c.addTextDisplayComponents(text);
  }
  return { flags: MessageFlags.IsComponentsV2, components: [c] };
}

const FreeGames: Command = {
  data: new SlashCommandBuilder()
    .setName('freegames')
    .setDescription('Check free games')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addSubcommand(s => s.setName('now').setDescription('Games that are free right now (Epic, Steam, GOG)'))
    .addSubcommand(s => s.setName('upcoming').setDescription('Upcoming free games on Epic Games Store')) as any,

  async run(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply();

    if (sub === 'upcoming') {
      const games = await fetchEpicUpcomingGames();
      if (!games.length) {
        await interaction.editReply(card({ title: '🗓️ Coming free on Epic', description: 'No upcoming free games announced yet. Check back later!' }));
        return;
      }
      await interaction.editReply(gameList(games, true));
      return;
    }

    // sub === 'now'
    const games = await fetchAllFreeGames();
    if (!games.length) {
      await interaction.editReply(card({ title: '🎮 Free right now', description: 'No free games found right now. Check back later!' }));
      return;
    }
    await interaction.editReply(gameList(games));
  },
};

export default FreeGames;
