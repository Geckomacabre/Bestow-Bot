import { Client, EmbedBuilder, Colors, TextChannel } from 'discord.js';
import * as db from '../../utils/db';

export function startTopicPoller(bot: Client) {
  const check = async () => {
    const channels = await db.getAllTopicChannels();
    const now = Date.now();

    for (const tc of channels) {
      if (now - tc.last_posted < tc.interval_seconds * 1000) continue;

      const topic = await db.getNextTopic(tc.guild_id, tc.channel_id, tc.mode);
      if (!topic) continue;

      const guild = bot.guilds.cache.get(tc.guild_id);
      const channel = guild?.channels.cache.get(tc.channel_id) as TextChannel | null;
      if (!channel?.isTextBased()) continue;

      const embed = new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle('💬 Discussion Topic')
        .setDescription(topic.text)
        .setTimestamp();

      await (channel as TextChannel).send({ embeds: [embed] }).catch(() => {});

      await db.updateTopicLastPosted(tc.id);
      if (tc.mode === 'sequential') {
        await db.rotateTopic(tc.guild_id, tc.channel_id);
      }
    }
  };

  // Check every minute
  setInterval(check, 60_000);
  setTimeout(check, 15_000);
}
