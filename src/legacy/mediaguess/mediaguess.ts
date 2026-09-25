import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors, EmbedBuilder,
  InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, TextChannel,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { activeGames, resolveGame, startGame, cancelSkipTimer, type MediaType } from '../../utils/mediagame';
import * as db from '../../utils/db';

const TYPE_LABEL: Record<MediaType, string> = { movie: 'Movie', tv: 'TV Show', game: 'Video Game', music: 'Song' };
const TYPE_EMOJI: Record<MediaType, string> = { movie: '🎬', tv: '📺', game: '🎮', music: '🎵' };

function configChannel(cfg: db.IMediaGuessConfig | null, type: MediaType): string | null {
  return type === 'movie' ? cfg?.movie_channel_id ?? null
    : type === 'tv' ? cfg?.tv_channel_id ?? null
    : type === 'game' ? cfg?.game_channel_id ?? null
    : cfg?.music_channel_id ?? null;
}

const MediaGuess: Command = {
  data: new SlashCommandBuilder()
    .setName('mediaguess')
    .setDescription('Manage the movie, TV, game & music guessing games')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(s => s
      .setName('setup')
      .setDescription('Set or change the channel for a guessing game')
      .addStringOption(o => o
        .setName('type')
        .setDescription('Which game to configure')
        .setRequired(true)
        .addChoices(
          { name: 'Movie', value: 'movie' },
          { name: 'TV Show', value: 'tv' },
          { name: 'Video Game', value: 'game' },
          { name: 'Song', value: 'music' },
        ),
      )
      .addChannelOption(o => o
        .setName('channel')
        .setDescription('Channel to run the game in')
        .setRequired(true),
      ),
    )
    .addSubcommand(s => s
      .setName('stop')
      .setDescription('Stop the guessing game in this channel and remove its config'),
    )
    .addSubcommand(s => s
      .setName('skip')
      .setDescription('Admin-force skip the current round without a vote'),
    )
    .addSubcommand(s => s
      .setName('info')
      .setDescription('Show current guessing game configuration'),
    ) as any,

  async run(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId!;

    // ── Setup ───────────────────────────────────────────────────────────────────
    if (sub === 'setup') {
      const type = interaction.options.getString('type', true) as MediaType;
      const channel = interaction.options.getChannel('channel', true) as TextChannel;

      if ((type === 'movie' || type === 'tv') && !Bun.env.TMDB_API_KEY) {
        await interaction.reply({ content: '❌ `TMDB_API_KEY` isn\'t set in the bot\'s environment — movie/TV guessing needs it. Ask whoever hosts the bot to add one (free at themoviedb.org).', flags: MessageFlags.Ephemeral });
        return;
      }
      if (type === 'game' && !Bun.env.RAWG_API_KEY) {
        await interaction.reply({ content: '❌ `RAWG_API_KEY` isn\'t set in the bot\'s environment — game guessing needs it. Ask whoever hosts the bot to add one (free at rawg.io/apidocs).', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await db.setMediaGuessConfig(guildId, type, channel.id);

      // Stop any existing game in that channel before starting a new one
      const existing = activeGames.get(channel.id);
      if (existing) {
        existing.answered = true;
        activeGames.delete(channel.id);
        await db.deleteMediaGuessRound(channel.id).catch(() => {});
        cancelSkipTimer(channel.id);
      }

      await startGame(guildId, channel.id, type, interaction.client);

      await interaction.editReply(`✅ **${TYPE_LABEL[type]}** guessing game configured in <#${channel.id}>. First round is live!`);
    }

    // ── Stop ────────────────────────────────────────────────────────────────────
    else if (sub === 'stop') {
      const state = activeGames.get(interaction.channelId);
      if (!state) {
        await interaction.reply({ content: '❌ No active guessing game in this channel.', flags: MessageFlags.Ephemeral });
        return;
      }

      await db.setMediaGuessConfig(guildId, state.type, null);

      state.answered = true;
      activeGames.delete(interaction.channelId);
      await db.deleteMediaGuessRound(interaction.channelId).catch(() => {});
      cancelSkipTimer(interaction.channelId);

      await interaction.reply({
        content: `🛑 Game stopped. The answer was **${state.media.title}**. Configure a new game with \`/server guess setup\`.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── Admin skip ──────────────────────────────────────────────────────────────
    else if (sub === 'skip') {
      const state = activeGames.get(interaction.channelId);
      if (!state || state.answered) {
        await interaction.reply({ content: '❌ No active guessing game in this channel.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.reply({ content: `⏭️ Skipping round (admin override). Answer: **${state.media.title}**` });
      await resolveGame(state, interaction.client, null, 'skip');
    }

    // ── Info ────────────────────────────────────────────────────────────────────
    else if (sub === 'info') {
      const cfg = await db.getMediaGuessConfig(guildId);

      const fields = (['movie', 'tv', 'game', 'music'] as MediaType[]).flatMap(type => {
        const channelId = configChannel(cfg, type);
        const state = channelId ? activeGames.get(channelId) : null;
        const status = state
          ? `Active — ${state.hintsUsed}/${state.hintOrder.length} hints used, ${state.voteskips.size}/2 skip votes`
          : (channelId ? 'Channel set but no active round' : 'Not configured');
        return [
          { name: `${TYPE_EMOJI[type]} ${TYPE_LABEL[type]} Channel`, value: channelId ? `<#${channelId}>` : 'Not set', inline: true },
          { name: `${TYPE_LABEL[type]} Status`, value: status, inline: true },
          { name: '​', value: '​', inline: true },
        ];
      });

      const embed = new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle('🎮 Guessing Game Config')
        .addFields(fields);

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },
};

export default MediaGuess;
