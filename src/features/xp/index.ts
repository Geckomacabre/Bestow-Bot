import { TextChannel } from 'discord.js';
import { EventModule } from '../feature';
import { getXpConfig, addXp, getLevelRoles, adjustBalance, getXpMultiplier } from '../../utils/db';
import type { Client } from 'discord.js';

const VOICE_XP_PER_MINUTE   = 10;
const VOICE_SESSION_CAP_MIN = 60; // stop earning after 60 continuous minutes

// In-memory cooldown: `${guild_id}:${user_id}` -> timestamp last XP was awarded
const xpCooldowns = new Map<string, number>();

// Track when each user joined a VC: `${guild_id}:${user_id}` -> timestamp
const voiceJoinTimes = new Map<string, number>();

// Clean up stale cooldown entries every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [key, ts] of xpCooldowns) {
    if (ts < cutoff) xpCooldowns.delete(key);
  }
}, 600_000);

async function handleLevelUp(
  guildId: string,
  userId: string,
  oldLevel: number,
  newLevel: number,
  bot: Client,
  fallbackChannelId?: string,
) {
  for (let lvl = oldLevel + 1; lvl <= newLevel; lvl++) {
    await adjustBalance(guildId, userId, lvl * 50).catch(() => {});
  }

  const levelRoles = await getLevelRoles(guildId);
  const earned = levelRoles.filter(r => r.level <= newLevel);
  if (earned.length > 0) {
    const guild = bot.guilds.cache.get(guildId);
    const member = await guild?.members.fetch(userId).catch(() => null);
    if (member) {
      const toAdd = earned.map(r => r.role_id).filter(id => !member.roles.cache.has(id));
      if (toAdd.length > 0) await member.roles.add(toAdd).catch(() => {});
    }
  }

  const config = await getXpConfig(guildId);
  if (!config.level_up_announce) return;

  const channelId = config.level_up_channel_id ?? fallbackChannelId;
  if (!channelId) return;

  const channel = bot.channels.cache.get(channelId) as TextChannel | undefined;
  if (!channel) return;

  const guild = bot.guilds.cache.get(guildId);
  const member = await guild?.members.fetch(userId).catch(() => null);
  const username = member?.user.username ?? 'Unknown';

  const text = config.level_up_message
    .replace(/{user}/g, `<@${userId}>`)
    .replace(/{username}/g, username)
    .replace(/{level}/g, String(newLevel));

  await channel.send(text).catch(() => {});
}

const xpModule: EventModule = {
  name: 'xp',
  handlers: {
    messageCreate: async ({ data: [message], bot }) => {
      if (message.author.bot || !message.guild) return;

      const guildId = message.guild.id;
      const userId = message.author.id;
      const key = `${guildId}:${userId}`;

      const config = await getXpConfig(guildId);
      if (!config.enabled) return;

      const now = Date.now();
      const lastXp = xpCooldowns.get(key) ?? 0;
      if (now - lastXp < config.cooldown_seconds * 1000) return;

      xpCooldowns.set(key, now);

      let amount = Math.floor(Math.random() * (config.xp_max - config.xp_min + 1)) + config.xp_min;

      const xpMult = await getXpMultiplier(guildId, userId);
      if (xpMult > 1.0) amount = Math.floor(amount * xpMult);

      const { row, oldLevel } = await addXp(guildId, userId, amount);
      if (row.level <= oldLevel) return;

      await handleLevelUp(guildId, userId, oldLevel, row.level, bot, message.channel.id);
    },

    voiceStateUpdate: async ({ data: [oldState, newState], bot }) => {
      const member = newState.member ?? oldState.member;
      if (!member || member.user.bot) return;

      const guildId = newState.guild.id;
      const userId = member.user.id;
      const key = `${guildId}:${userId}`;

      const joinedVC = !oldState.channelId && !!newState.channelId;
      const leftVC   = !!oldState.channelId && !newState.channelId;

      if (joinedVC) {
        voiceJoinTimes.set(key, Date.now());
        return;
      }

      if (leftVC) {
        const joinTime = voiceJoinTimes.get(key);
        voiceJoinTimes.delete(key);
        if (!joinTime) return;

        const minutesSpent = (Date.now() - joinTime) / 60_000;
        const cappedMinutes = Math.min(minutesSpent, VOICE_SESSION_CAP_MIN);
        const xpAmount = Math.floor(cappedMinutes * VOICE_XP_PER_MINUTE);
        if (xpAmount < 1) return;

        const config = await getXpConfig(guildId);
        if (!config.enabled) return;

        const xpMult = await getXpMultiplier(guildId, userId);
        const finalXp = xpMult > 1.0 ? Math.floor(xpAmount * xpMult) : xpAmount;

        const { row, oldLevel } = await addXp(guildId, userId, finalXp);
        if (row.level <= oldLevel) return;

        await handleLevelUp(guildId, userId, oldLevel, row.level, bot);
      }
    },
  },
};

export default xpModule;
