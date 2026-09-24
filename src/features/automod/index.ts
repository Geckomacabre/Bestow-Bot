import { GuildMember, TextChannel } from 'discord.js';
import { EventModule } from '../feature';

// Per-guild message tracking for spam detection
const spamTracker = new Map<string, { userId: string; timestamps: number[] }[]>();

function getSpamKey(guildId: string) {
  if (!spamTracker.has(guildId)) spamTracker.set(guildId, []);
  return spamTracker.get(guildId)!;
}

const automodModule: EventModule = {
  name: 'automod',
  handlers: {
    messageCreate: async ({ data: [message], bot, db }) => {
      if (!message.guildId || !message.author || message.author.bot) return;
      // Skip users with Manage Messages permission
      if ((message.member as GuildMember)?.permissions.has('ManageMessages')) return;

      const rules = await db.getAutomodRules(message.guildId);
      const enabled = rules.filter(r => r.enabled);

      for (const rule of enabled) {
        let triggered = false;
        const content = message.content ?? '';

        switch (rule.trigger_type) {
          case 'spam': {
            const limit = parseInt(rule.trigger_value) || 5;
            const windowMs = 5000;
            const tracker = getSpamKey(message.guildId);
            const now = Date.now();
            let entry = tracker.find(e => e.userId === message.author!.id);
            if (!entry) { entry = { userId: message.author.id, timestamps: [] }; tracker.push(entry); }
            entry.timestamps = entry.timestamps.filter(t => now - t < windowMs);
            entry.timestamps.push(now);
            if (entry.timestamps.length >= limit) triggered = true;
            break;
          }
          case 'caps': {
            const threshold = parseInt(rule.trigger_value) || 70;
            const letters = content.replace(/[^a-zA-Z]/g, '');
            if (letters.length < 8) break;
            const capsPercent = (letters.replace(/[^A-Z]/g, '').length / letters.length) * 100;
            if (capsPercent >= threshold) triggered = true;
            break;
          }
          case 'links': {
            if (/https?:\/\/\S+/i.test(content)) triggered = true;
            break;
          }
          case 'words': {
            const badWords = rule.trigger_value.split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
            const lower = content.toLowerCase();
            if (badWords.some(w => lower.includes(w))) triggered = true;
            break;
          }
          case 'mentions': {
            const limit = parseInt(rule.trigger_value) || 5;
            const mentionCount = (message.mentions.users.size + message.mentions.roles.size);
            if (mentionCount >= limit) triggered = true;
            break;
          }
          case 'regex': {
            try {
              const re = new RegExp(rule.trigger_value, 'i');
              if (re.test(content)) triggered = true;
            } catch {}
            break;
          }
        }

        if (!triggered) continue;

        const reason = rule.action_reason ?? `AutoMod: ${rule.name}`;

        switch (rule.action) {
          case 'delete':
            await message.delete().catch(() => {});
            break;
          case 'warn':
            await message.delete().catch(() => {});
            await message.channel.send(`⚠️ <@${message.author.id}> ${reason}`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000)).catch(() => {});
            break;
          case 'timeout': {
            const duration = rule.action_duration ? rule.action_duration * 1000 : 60_000;
            await message.delete().catch(() => {});
            await (message.member as GuildMember)?.timeout(duration, reason).catch(() => {});
            await message.channel.send(`⏱️ <@${message.author.id}> has been timed out. Reason: ${reason}`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000)).catch(() => {});
            break;
          }
          case 'kick':
            await message.delete().catch(() => {});
            await (message.member as GuildMember)?.kick(reason).catch(() => {});
            break;
          case 'ban':
            await message.delete().catch(() => {});
            await message.guild?.members.ban(message.author.id, { reason }).catch(() => {});
            break;
        }

        break; // stop after first matching rule
      }
    },
  },
};

export default automodModule;
