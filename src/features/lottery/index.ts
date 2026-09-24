import { Client, TextChannel } from 'discord.js';
import {
  getLotteryConfigs, getLotteryLastRun, setLotteryLastRun,
  getRandomLotteryWinner, adjustBalance, clearGuildBoosts,
  getLotteryLastMessage, setLotteryLastMessage,
  getLotteryLastWinner, setLotteryLastWinner, getEconomyConfig,
} from '../../utils/db';

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

async function drawAndAnnounce(
  client: Client,
  guildId: string,
  channelId: string,
  prize: number,
  options: { excludeId?: string; reroll?: boolean } = {},
): Promise<{ ok: boolean; reason?: string; winnerId?: string }> {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { ok: false, reason: 'Could not access the server.' };
  const members = await guild.members.fetch().catch(() => guild.members.cache);
  const eligibleIds = new Set(members.keys());
  if (options.excludeId) eligibleIds.delete(options.excludeId);

  const winnerId = await getRandomLotteryWinner(guildId, eligibleIds);
  // Loaded Dice only applies to one draw — clear them win or lose.
  await clearGuildBoosts(guildId, 'lotto').catch(() => {});
  if (!winnerId) return { ok: false, reason: 'No eligible members to draw from.' };

  await adjustBalance(guildId, winnerId, prize).catch(() => {});
  await setLotteryLastWinner(guildId, winnerId, prize);

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!(channel instanceof TextChannel)) return { ok: true, winnerId };

  // Clean up the previous winner announcement before posting the new one.
  const lastMsg = await getLotteryLastMessage(guildId);
  if (lastMsg) {
    await channel.messages.delete(lastMsg.messageId).catch(() => {});
  }

  const heading = options.reroll ? '🎰 **Daily Lottery! (Rerolled)**' : '🎰 **Daily Lottery!**';
  const msg = await channel.send(
    `${heading}\n<@${winnerId}> is today's lucky winner and received **🪙 ${prize.toLocaleString()} coins**! 🎉`
  ).catch(() => null);

  if (msg) await setLotteryLastMessage(guildId, channelId, msg.id);
  return { ok: true, winnerId };
}

async function checkAndRunLottery(client: Client): Promise<void> {
  const today = todayUTC();
  const configs = await getLotteryConfigs();

  for (const cfg of configs) {
    const lastRun = await getLotteryLastRun(cfg.guild_id);
    if (lastRun === today) continue;

    await setLotteryLastRun(cfg.guild_id, today);
    await drawAndAnnounce(client, cfg.guild_id, cfg.lottery_channel_id, cfg.lottery_prize).catch(console.error);
  }
}

export async function rerollLottery(client: Client, guildId: string): Promise<{ ok: boolean; message: string }> {
  const cfg = await getEconomyConfig(guildId);
  if (!cfg.lottery_enabled || !cfg.lottery_channel_id) {
    return { ok: false, message: 'The daily lottery is not enabled on this server.' };
  }

  const lastRun = await getLotteryLastRun(guildId);
  if (lastRun !== todayUTC()) {
    return { ok: false, message: "Today's lottery hasn't run yet — nothing to reroll." };
  }

  const previous = await getLotteryLastWinner(guildId);
  if (previous) {
    // Best-effort clawback — if they've already spent it, leave their balance alone.
    await adjustBalance(guildId, previous.winnerId, -previous.prize).catch(() => {});
  }

  const result = await drawAndAnnounce(
    client, guildId, cfg.lottery_channel_id, cfg.lottery_prize,
    { excludeId: previous?.winnerId, reroll: true },
  );

  if (!result.ok) {
    return { ok: false, message: result.reason ?? 'Could not draw a new winner.' };
  }
  return { ok: true, message: `🎉 New winner: <@${result.winnerId}>` };
}

export function startLottery(client: Client): void {
  // Check every hour
  setInterval(() => checkAndRunLottery(client).catch(console.error), 3_600_000);
  // Also check immediately on startup
  checkAndRunLottery(client).catch(console.error);
}
