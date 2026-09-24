import { Client, TextChannel } from 'discord.js';
import { addXp, getXpConfig, getLevelRoles, adjustBalance, getXpMultiplier, getGameXpUsedToday, addGameXpToday } from './db.js';

const GAME_XP_DAILY_CAP = 1000;

async function handleLevelUp(
  guildId: string, userId: string, newLevel: number,
  client: Client, fallbackChannelId: string,
) {
  await adjustBalance(guildId, userId, newLevel * 50).catch(() => {});

  const levelRoles = await getLevelRoles(guildId);
  const earned = levelRoles.filter(r => r.level <= newLevel);
  if (earned.length > 0) {
    const guild = client.guilds.cache.get(guildId);
    if (guild) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member) {
        const toAdd = earned.map(r => r.role_id).filter(id => !member.roles.cache.has(id));
        if (toAdd.length) await member.roles.add(toAdd).catch(() => {});
      }
    }
  }

  const config = await getXpConfig(guildId);
  if (!config.level_up_announce) return;

  const announceChannelId = config.level_up_channel_id ?? fallbackChannelId;
  const channel = client.channels.cache.get(announceChannelId) as TextChannel | undefined;
  if (!channel) return;

  const guild = client.guilds.cache.get(guildId);
  const member = await guild?.members.fetch(userId).catch(() => null);
  const username = member?.user.username ?? 'Unknown';

  const text = config.level_up_message
    .replace(/{user}/g, `<@${userId}>`)
    .replace(/{username}/g, username)
    .replace(/{level}/g, String(newLevel));

  await channel.send(text).catch(() => {});
}

/**
 * Award bonus XP from a rep or game win.
 * @param isGame - if true, applies and enforces the 1000 XP/day game cap (DB-backed)
 * @returns how much XP was actually awarded (0 if cap reached or XP disabled)
 */
export async function awardBonusXp(opts: {
  guildId: string;
  userId: string;
  baseAmount: number;
  client: Client;
  channelId: string;
  isGame?: boolean;
}): Promise<number> {
  const { guildId, userId, baseAmount, client, channelId, isGame = false } = opts;

  const config = await getXpConfig(guildId);
  if (!config.enabled) return 0;

  // Apply XP boost FIRST so the cap enforces on actual XP being awarded
  const xpMult = await getXpMultiplier(guildId, userId);
  let amount = xpMult > 1.0 ? Math.floor(baseAmount * xpMult) : baseAmount;

  if (isGame) {
    const usedToday = await getGameXpUsedToday(guildId, userId);
    const remaining = Math.max(0, GAME_XP_DAILY_CAP - usedToday);
    if (remaining <= 0) return 0;
    amount = Math.min(amount, remaining);
    await addGameXpToday(guildId, userId, amount);
  }

  const { row, oldLevel } = await addXp(guildId, userId, amount, false);
  if (row.level > oldLevel) {
    for (let lvl = oldLevel + 1; lvl < row.level; lvl++) {
      await adjustBalance(guildId, userId, lvl * 50).catch(() => {});
    }
    await handleLevelUp(guildId, userId, row.level, client, channelId);
  }

  return amount;
}

export function getGameXpRemaining(_guildId: string, _userId: string): number {
  // Kept for backwards compatibility — callers should use awardBonusXp instead
  return GAME_XP_DAILY_CAP;
}
