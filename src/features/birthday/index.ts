import { Client, EmbedBuilder, Colors, TextChannel } from 'discord.js';
import * as db from '../../utils/db';

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

      const embed = new EmbedBuilder()
        .setColor(Colors.Gold)
        .setTitle('🎂 Happy Birthday!')
        .setDescription(`Today is **${member.displayName}**'s birthday! Wish them a happy birthday! 🎉`)
        .setThumbnail(member.user.displayAvatarURL())
        .setTimestamp();

      await (channel as TextChannel).send({ content: `<@${bday.user_id}>`, embeds: [embed] }).catch(() => {});
    }
  };

  // Check every hour
  setInterval(check, 60 * 60 * 1000);
  // Also check shortly after startup
  setTimeout(check, 10_000);
}
