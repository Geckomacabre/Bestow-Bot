import { Client, ChannelType } from 'discord.js';
import * as db from '../../utils/db';

function getStatValue(guild: any, type: string): string {
  switch (type) {
    case 'members':  return guild.memberCount.toLocaleString();
    case 'humans':   return guild.members.cache.filter((m: any) => !m.user.bot).size.toLocaleString();
    case 'bots':     return guild.members.cache.filter((m: any) => m.user.bot).size.toLocaleString();
    case 'channels': return guild.channels.cache.filter((c: any) => c.type !== ChannelType.GuildCategory).size.toLocaleString();
    case 'roles':    return (guild.roles.cache.size - 1).toLocaleString();
    default:         return '?';
  }
}

export function startStatChannelUpdater(bot: Client) {
  const update = async () => {
    const all = await db.getAllStatChannels();
    for (const sc of all) {
      const guild = bot.guilds.cache.get(sc.guild_id);
      if (!guild) continue;

      const channel = guild.channels.cache.get(sc.channel_id);
      if (!channel) {
        await db.removeStatChannel(sc.guild_id, sc.channel_id).catch(() => {});
        continue;
      }

      const newName = `${sc.label}: ${getStatValue(guild, sc.type)}`;
      if (channel.name !== newName) {
        await channel.setName(newName).catch(() => {});
      }

      // 5s gap between each channel to respect rate limits (2 renames/10min per channel)
      await new Promise(r => setTimeout(r, 5_000));
    }
  };

  setTimeout(update, 30_000);
  setInterval(update, 10 * 60 * 1_000);
}
