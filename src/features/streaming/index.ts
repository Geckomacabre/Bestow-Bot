import { ActivityType, TextChannel } from 'discord.js';
import { EventModule } from '../feature';

// Track who was already announced to avoid spam
const announcedUsers = new Map<string, Set<string>>(); // guildId -> Set<userId>

const streamingModule: EventModule = {
  name: 'streaming',
  handlers: {
    presenceUpdate: async ({ data: [oldPresence, newPresence], bot, db }) => {
      if (!newPresence?.guild || newPresence.user?.bot) return;
      const guildId = newPresence.guild.id;
      const userId = newPresence.userId;

      const cfg = await db.getStreamingConfig(guildId);
      if (!cfg?.announce_channel_id) return;

      const wasStreaming = oldPresence?.activities.some(a => a.type === ActivityType.Streaming) ?? false;
      const isStreaming = newPresence.activities.some(a => a.type === ActivityType.Streaming);

      if (!announcedUsers.has(guildId)) announcedUsers.set(guildId, new Set());
      const announced = announcedUsers.get(guildId)!;

      if (isStreaming && !wasStreaming && !announced.has(userId)) {
        announced.add(userId);
        const streamActivity = newPresence.activities.find(a => a.type === ActivityType.Streaming)!;
        const member = await newPresence.guild.members.fetch(userId).catch(() => null);
        if (!member) return;

        // Assign streaming role if configured
        if (cfg.give_role_id) {
          await member.roles.add(cfg.give_role_id).catch(() => {});
        }

        const channel = await bot.channels.fetch(cfg.announce_channel_id).catch(() => null) as TextChannel | null;
        if (!channel) return;

        const msg = cfg.message
          .replace('{username}', member.displayName)
          .replace('{game}', streamActivity.name ?? 'something')
          .replace('{url}', streamActivity.url ?? '');

        await channel.send(msg).catch(() => {});
      } else if (!isStreaming && wasStreaming) {
        announced.delete(userId);
        const member = await newPresence.guild.members.fetch(userId).catch(() => null);
        if (cfg.give_role_id && member) {
          await member.roles.remove(cfg.give_role_id).catch(() => {});
        }
      }
    },
  },
};

export default streamingModule;
