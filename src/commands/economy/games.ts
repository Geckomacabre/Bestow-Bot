import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  ContainerBuilder, InteractionContextType, SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { getGameLeaderboard, getEconomyConfig } from '../../utils/db';
import { IS_CV2 } from '../../utils/components.js';

const GAME_CHOICES = [
  { name: 'Coin Flip',        value: 'flip'             },
  { name: 'High Roll',        value: 'highroll'         },
  { name: 'Slots',            value: 'slots'            },
  { name: 'Roulette',         value: 'roulette'         },
  { name: 'Crash',            value: 'crash'            },
  { name: 'Blackjack',        value: 'blackjack'        },
  { name: 'Video Poker',      value: 'poker'            },
  { name: 'Scratch Card',     value: 'scratch'          },
  { name: 'Plinko',           value: 'plinko'           },
  { name: 'Movie Guesser',    value: 'mediaguess_movie' },
  { name: 'TV Show Guesser',  value: 'mediaguess_tv'   },
  { name: 'Game Guesser',     value: 'mediaguess_game' },
  { name: 'Song Guesser',     value: 'mediaguess_music' },
] as const;

const GAME_EMOJI: Record<string, string> = {
  flip: '🪙', highroll: '🎲', slots: '🎰',
  roulette: '🎡', crash: '🚀', blackjack: '🃏',
  poker: '♠️', scratch: '🎟️', plinko: '🎲',
  mediaguess_movie: '🎬', mediaguess_tv: '📺',
  mediaguess_game: '🎮', mediaguess_music: '🎵',
};

const Games: Command = {
  data: new SlashCommandBuilder()
    .setName('games')
    .setDescription('Game leaderboards')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(sub =>
      sub
        .setName('leaderboard')
        .setDescription('Top players for a specific game')
        .addStringOption(o =>
          o.setName('game')
            .setDescription('Which game to show')
            .setRequired(true)
            .addChoices(...GAME_CHOICES),
        ),
    ),

  async run(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    if (sub !== 'leaderboard') return;

    await interaction.deferReply();

    const game     = interaction.options.getString('game', true);
    const guildId  = interaction.guildId!;
    const [rows, cfg] = await Promise.all([
      getGameLeaderboard(guildId, game, 10),
      getEconomyConfig(guildId),
    ]);

    const label = GAME_CHOICES.find(g => g.value === game)?.name ?? game;
    const emoji = GAME_EMOJI[game] ?? '🎮';

    if (!rows.length) {
      const container = new ContainerBuilder()
        .setAccentColor(Colors.Blurple)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `${emoji} **${label} Leaderboard**\n\nNo one has played this game yet!`,
        ));
      await interaction.editReply({ flags: IS_CV2 as any, components: [container] });
      return;
    }

    const isGuess = game.startsWith('mediaguess');
    const lines = rows.map((row, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
      if (isGuess) {
        return `${medal} <@${row.user_id}> — **${row.wins}** correct guess${row.wins !== 1 ? 'es' : ''}`;
      }
      const total = row.wins + row.losses;
      const rate  = total > 0 ? Math.round((row.wins / total) * 100) : 0;
      return `${medal} <@${row.user_id}> — **${row.wins}W** / ${row.losses}L *(${rate}% win rate)*`;
    });

    const sym = cfg.currency_symbol;
    const footer = isGuess ? '*Ranked by correct guesses*' : `*Ranked by wins · ${sym} ${cfg.currency_name}*`;
    const container = new ContainerBuilder()
      .setAccentColor(Colors.Gold)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `${emoji} **${label} Leaderboard**\n\n${lines.join('\n')}\n\n${footer}`,
      ));

    await interaction.editReply({ flags: IS_CV2 as any, components: [container] });
  },
};

export default Games;
