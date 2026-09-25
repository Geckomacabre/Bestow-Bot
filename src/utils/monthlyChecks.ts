import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import * as db from './db.js';
import { activeGames, resolveGame, startGame, type MediaType } from './mediagame.js';

async function fetchChannel(channelId: string, bot: Client): Promise<TextChannel | null> {
  const cached = bot.channels.cache.get(channelId) as TextChannel | undefined;
  if (cached) return cached;
  return (await bot.channels.fetch(channelId).catch(() => null)) as TextChannel | null;
}


// ─── Monthly guessing game reset ───────────────────────────────────────────────
// Posts a leaderboard to each configured channel, then forces a fresh round —
// game_stats are left untouched, only the current round is cut short.

const GUESS_TYPES: { type: MediaType; column: keyof db.IMediaGuessConfig; label: string; statKey: string }[] = [
  { type: 'movie', column: 'movie_channel_id', label: '🎬 Movie Guessing', statKey: 'mediaguess_movie' },
  { type: 'tv', column: 'tv_channel_id', label: '📺 TV Show Guessing', statKey: 'mediaguess_tv' },
  { type: 'game', column: 'game_channel_id', label: '🎮 Game Guessing', statKey: 'mediaguess_game' },
  { type: 'music', column: 'music_channel_id', label: '🎵 Song Guessing', statKey: 'mediaguess_music' },
];

async function postGuessLeaderboard(channel: TextChannel, guildId: string, label: string, statKey: string): Promise<void> {
  const rows = await db.getGameLeaderboard(guildId, statKey, 10);
  if (!rows.length) return;

  const lines = rows.map((r, i) => `**${i + 1}.** <@${r.user_id}> — ${r.wins} win${r.wins === 1 ? '' : 's'}`);
  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setTitle(`🏆 ${label} — Monthly Leaderboard`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'A fresh round starts now!' })
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => {});
}

async function forceNewRound(channelId: string, guildId: string, type: MediaType, bot: Client): Promise<void> {
  const state = activeGames.get(channelId);
  if (state && !state.answered) {
    state.answered = true;
    await resolveGame(state, bot, null, 'skip');
    return;
  }
  await startGame(guildId, channelId, type, bot).catch(() => {});
}

export async function runMonthlyGuessingReset(bot: Client): Promise<void> {
  const configs = await db.getAllMediaGuessConfigs();
  for (const cfg of configs) {
    for (const { type, column, label, statKey } of GUESS_TYPES) {
      const channelId = cfg[column] as string | null;
      if (!channelId) continue;
      try {
        const channel = await fetchChannel(channelId, bot);
        if (!channel) continue;
        await postGuessLeaderboard(channel, cfg.guild_id, label, statKey);
        await forceNewRound(channelId, cfg.guild_id, type, bot);
      } catch (err) {
        console.error(`[monthly] guessing reset failed for guild ${cfg.guild_id} (${type}):`, err);
      }
    }
  }
}
