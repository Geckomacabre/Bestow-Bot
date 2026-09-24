import { Client, EmbedBuilder, PermissionFlagsBits, TextChannel } from 'discord.js';
import * as db from './db.js';
import { archiveTicket } from './tickets.js';
import { activeGames, resolveGame, startGame, type MediaType } from './mediagame.js';

// ─── Monthly ticket maintenance ────────────────────────────────────────────────
// Auto-closes stale tickets, runs a synthetic "bug check" ticket to prove the
// create/close flow still works, then posts a report to the log channel.

const STALE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days of no activity
const REPORT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // "this month" ~= trailing 30 days

async function fetchChannel(channelId: string, bot: Client): Promise<TextChannel | null> {
  const cached = bot.channels.cache.get(channelId) as TextChannel | undefined;
  if (cached) return cached;
  return (await bot.channels.fetch(channelId).catch(() => null)) as TextChannel | null;
}

async function autoCloseStaleTickets(guildId: string, bot: Client, cfg: db.ITicketConfig): Promise<number> {
  const openTickets = await db.getOpenTickets(guildId);
  let closed = 0;

  for (const ticket of openTickets) {
    const channel = await fetchChannel(ticket.channel_id, bot);
    if (!channel) {
      // Channel is gone but the ticket is still marked open — close the record
      // so it stops skewing stats, but nothing to notify.
      await db.closeTicket(ticket.channel_id);
      continue;
    }

    const lastMsg = await channel.messages.fetch({ limit: 1 }).catch(() => null);
    const lastActivity = lastMsg?.first()?.createdTimestamp ?? ticket.created_at;
    if (Date.now() - lastActivity < STALE_MS) continue;

    await db.closeTicket(ticket.channel_id);
    closed++;
    await channel.send('🕒 This ticket has been automatically closed after **14 days** of inactivity (monthly maintenance check).').catch(() => {});
    await archiveTicket(channel, ticket, cfg, bot).catch(() => {});
  }

  return closed;
}

async function runBugCheckTicket(guildId: string, bot: Client, cfg: db.ITicketConfig): Promise<{ ok: boolean; error?: string }> {
  const guild = bot.guilds.cache.get(guildId);
  if (!guild) return { ok: false, error: 'Guild not found in cache' };

  try {
    const me = guild.members.me;
    if (!me) return { ok: false, error: 'Bot member not found in guild' };

    const opts: any = {
      name: 'monthly-bug-check',
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
      ],
      topic: 'Automated monthly ticket system health check',
    };
    if (cfg.category_id) opts.parent = cfg.category_id;

    const channel = await guild.channels.create(opts) as TextChannel;
    const ticket = await db.createTicket(guildId, channel.id, bot.user!.id, 'this is a monthly bug check');
    await channel.send(`🩺 **Monthly Bug Check** — Ticket #${ticket.ticket_num}\nVerifying the ticket system can create and close tickets correctly.`);
    await db.closeTicket(channel.id);
    await channel.delete().catch(() => {});
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function postTicketReport(
  guildId: string, bot: Client, cfg: db.ITicketConfig,
  staleClosed: number, bugCheck: { ok: boolean; error?: string },
): Promise<void> {
  if (!cfg.log_channel_id) return;
  const logCh = await fetchChannel(cfg.log_channel_id, bot);
  if (!logCh) return;

  const since = Date.now() - REPORT_WINDOW_MS;
  const stats = await db.getMonthlyTicketStats(guildId, since);
  const feedback = stats.ratingCount
    ? `${stats.avgRating!.toFixed(1)}⭐ average (${stats.ratingCount} rating${stats.ratingCount === 1 ? '' : 's'})`
    : 'No ratings yet';

  const embed = new EmbedBuilder()
    .setColor(bugCheck.ok ? 0x57F287 : 0xED4245)
    .setTitle('📊 Monthly Ticket Report')
    .addFields(
      { name: 'Opened (30d)', value: String(stats.opened), inline: true },
      { name: 'Closed (30d)', value: String(stats.closed), inline: true },
      { name: 'Auto-closed (stale)', value: String(staleClosed), inline: true },
      { name: 'User Feedback', value: feedback, inline: false },
      {
        name: 'System Health Check',
        value: bugCheck.ok ? '✅ Ticket system is working correctly.' : `⚠️ Bug check failed: ${bugCheck.error ?? 'unknown error'}`,
        inline: false,
      },
    )
    .setFooter({ text: 'Automated monthly check' })
    .setTimestamp();

  await logCh.send({ embeds: [embed] }).catch(() => {});
}

export async function runMonthlyTicketChecks(bot: Client): Promise<void> {
  const configs = await db.getAllTicketConfigs();
  for (const cfg of configs) {
    try {
      const staleClosed = await autoCloseStaleTickets(cfg.guild_id, bot, cfg);
      const bugCheck = await runBugCheckTicket(cfg.guild_id, bot, cfg);
      await postTicketReport(cfg.guild_id, bot, cfg, staleClosed, bugCheck);
    } catch (err) {
      console.error(`[monthly] ticket check failed for guild ${cfg.guild_id}:`, err);
    }
  }
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
