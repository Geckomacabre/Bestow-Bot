import { Client, TextChannel } from 'discord.js';
import { card } from '../../lookups/card.js';
import * as db from '../../utils/db';
import { refreshAllBirthdayPanels } from '../../groupchat/boards.js';

let lastCheckedDay = -1;

export function startBirthdayChecker(bot: Client) {
  const check = async () => {
    const now = new Date();
    const day = now.getDate();
    if (day === lastCheckedDay) return;
    lastCheckedDay = day;

    const month = now.getMonth() + 1;
    const birthdays = await db.getTodaysBirthdays(month, day);

    for (const bday of birthdays) {
      const config = await db.getBirthdayConfig(bday.guild_id);
      if (!config.enabled || !config.channel_id) continue;

      const guild = bot.guilds.cache.get(bday.guild_id);
      if (!guild) continue;

      const member = await guild.members.fetch(bday.user_id).catch(() => null);
      if (!member) continue;

      const channel = guild.channels.cache.get(config.channel_id) as TextChannel | null;
      if (!channel?.isTextBased()) continue;

      // The mention pings them (and only them), as the old message's text did.
      await (channel as TextChannel).send(card({
        lead: `<@${bday.user_id}>`, mentions: { users: [bday.user_id] }, title: '🎂 Happy birthday!',
        description: `It's **${member.displayName}**'s birthday today — wish them a happy one! 🎉`, thumbnail: member.user.displayAvatarURL(),
      })).catch(() => {});
    }
  };

  // Check every hour
  setInterval(check, 60 * 60 * 1000);
  // Also check shortly after startup
  setTimeout(check, 10_000);

  // Live birthday panels (/server birthdays panel): each is only edited when what it shows has changed, so this is cheap.
  const panels = () => refreshAllBirthdayPanels(bot).catch(err => console.error(`[birthday panel] ${err}`));
  setInterval(panels, 15 * 60 * 1000);
  setTimeout(panels, 15_000);
}
