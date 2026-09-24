import { AuditLogEvent, ChatInputCommandInteraction, Colors, EmbedBuilder, Guild, GuildChannel, PartialUser, TextChannel, User } from 'discord.js';
import { EventModule } from '../feature';
import type * as Db from '../../utils/db';

type LogCategory = 'member' | 'message' | 'voice' | 'server' | 'command';

function resolveChannelId(cfg: Db.ILogConfig, category: LogCategory): string | null {
  switch (category) {
    case 'member':  return cfg.member_log_channel_id || cfg.channel_id || null;
    case 'message': return cfg.message_log_channel_id || cfg.channel_id || null;
    case 'voice':   return cfg.voice_log_channel_id || cfg.channel_id || null;
    case 'server':  return cfg.server_log_channel_id || cfg.channel_id || null;
    case 'command': return cfg.command_log_channel_id || cfg.channel_id || null;
  }
}

async function getLogChannel(bot: any, channelId: string | null): Promise<TextChannel | null> {
  if (!channelId) return null;
  try {
    const ch = await bot.channels.fetch(channelId);
    return ch instanceof TextChannel ? ch : null;
  } catch {
    return null;
  }
}

// Correlates an event with a recent matching audit-log entry to attribute WHO
// did it and WHY. Audit-log entries only exist for moderator/bot actions
// taken against someone else — a message someone deletes themselves, or a
// member who leaves voluntarily, never produces one, so a null return
// usually just means "no one else was involved," not a failed lookup. Also
// returns null (silently) if the bot lacks View Audit Log.
async function findAuditEntry(
  guild: Guild,
  type: AuditLogEvent,
  targetId: string,
  withinMs = 10_000,
): Promise<{ executor: User | PartialUser | null; reason: string | null } | null> {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    const entry = logs.entries.find(e => e.targetId === targetId && Date.now() - e.createdTimestamp < withinMs);
    return entry ? { executor: entry.executor, reason: entry.reason } : null;
  } catch {
    return null;
  }
}

// Renders a chat command invocation into a short "/command sub opt:val" string for logging.
function describeCommand(interaction: ChatInputCommandInteraction): string {
  const parts = [interaction.commandName];
  const group = interaction.options.getSubcommandGroup(false);
  if (group) parts.push(group);
  const sub = interaction.options.getSubcommand(false);
  if (sub) parts.push(sub);
  let cmd = `/${parts.join(' ')}`;
  const opts = (interaction.options as any).data as Array<{ name: string; value?: unknown; options?: unknown[] }> | undefined;
  const flat = (opts ?? []).flatMap(function walk(o: any): any[] {
    return o.options ? o.options.flatMap(walk) : [o];
  });
  const optStr = flat
    .filter(o => o.value !== undefined)
    .map(o => `${o.name}:${String(o.value).slice(0, 80)}`)
    .join(' ');
  if (optStr) cmd += ` ${optStr}`;
  return cmd.slice(0, 400);
}

// Called from onInteraction.ts for every successfully-dispatched slash command —
// not tied to a ClientEvents event, so it's a plain exported function rather than
// an EventModule handler.
export async function logCommandUsage(interaction: ChatInputCommandInteraction, db: typeof Db): Promise<void> {
  if (!interaction.guildId) return;
  const cfg = await db.getLogConfig(interaction.guildId);
  if (!cfg?.log_commands) return;
  const ch = await getLogChannel(interaction.client, resolveChannelId(cfg, 'command'));
  if (!ch) return;
  const embed = new EmbedBuilder()
    .setColor(Colors.Grey)
    .setDescription(`<@${interaction.user.id}> used \`${describeCommand(interaction)}\` in <#${interaction.channelId}>`)
    .setFooter({ text: `${interaction.user.tag} • ${interaction.user.id}` })
    .setTimestamp();
  await ch.send({ embeds: [embed] }).catch(() => {});
}

const logsModule: EventModule = {
  name: 'logs',
  handlers: {
    guildMemberAdd: async ({ data: [member], bot, db }) => {
      const cfg = await db.getLogConfig(member.guild.id);
      if (!cfg?.log_joins) return;
      const ch = await getLogChannel(bot, resolveChannelId(cfg, 'member'));
      if (!ch) return;
      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle('Member Joined')
        .setThumbnail(member.user.displayAvatarURL())
        .setDescription(`<@${member.id}> **${member.user.tag}**`)
        .addFields({ name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` })
        .setFooter({ text: `ID: ${member.id}` })
        .setTimestamp();
      await ch.send({ embeds: [embed] }).catch(() => {});
    },

    guildMemberRemove: async ({ data: [member], bot, db }) => {
      const cfg = await db.getLogConfig(member.guild.id);
      if (!cfg?.log_leaves) return;
      const ch = await getLogChannel(bot, resolveChannelId(cfg, 'member'));
      if (!ch) return;

      // A kick fires the same guildMemberRemove event as a voluntary leave —
      // the only way to tell them apart is a matching MemberKick audit-log entry.
      const kick = await findAuditEntry(member.guild, AuditLogEvent.MemberKick, member.id);

      const roles = member.roles.cache.filter(r => r.id !== member.guild.id);
      const rolesValue = roles.size
        ? [...roles.values()].slice(0, 20).map(r => `<@&${r.id}>`).join(', ') + (roles.size > 20 ? ` *(+${roles.size - 20} more)*` : '')
        : '*None*';

      const embed = new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle(kick ? 'Member Kicked' : 'Member Left')
        .setThumbnail(member.user.displayAvatarURL())
        .setDescription(`<@${member.id}> **${member.user.tag}**`)
        .addFields(
          {
            name: 'Joined',
            value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : '*Unknown*',
            inline: true,
          },
          { name: 'Roles', value: rolesValue },
        )
        .setFooter({ text: `ID: ${member.id}` })
        .setTimestamp();

      if (kick) {
        embed.addFields(
          { name: 'Kicked By', value: kick.executor ? `<@${kick.executor.id}> (${kick.executor.tag})` : '*Unknown*', inline: true },
          { name: 'Reason', value: kick.reason ?? 'No reason provided', inline: true },
        );
      }

      await ch.send({ embeds: [embed] }).catch(() => {});
    },

    guildMemberUpdate: async ({ data: [oldMember, newMember], bot, db }) => {
      const cfg = await db.getLogConfig(newMember.guild.id);
      if (!cfg?.enabled) return;
      const ch = await getLogChannel(bot, resolveChannelId(cfg, 'member'));
      if (!ch) return;

      if (cfg.log_nickname_changes && oldMember.nickname !== newMember.nickname) {
        const embed = new EmbedBuilder()
          .setColor(Colors.Yellow)
          .setTitle('Nickname Changed')
          .setDescription(`<@${newMember.id}> **${newMember.user.tag}**`)
          .addFields(
            { name: 'Before', value: oldMember.nickname ?? '*none*', inline: true },
            { name: 'After', value: newMember.nickname ?? '*none*', inline: true }
          )
          .setFooter({ text: `ID: ${newMember.id}` })
          .setTimestamp();
        await ch.send({ embeds: [embed] }).catch(() => {});
      }

      if (cfg.log_role_changes) {
        const added = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
        const removed = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
        if (added.size || removed.size) {
          const embed = new EmbedBuilder()
            .setColor(Colors.Blue)
            .setTitle('Roles Updated')
            .setDescription(`<@${newMember.id}> **${newMember.user.tag}**`)
            .setFooter({ text: `ID: ${newMember.id}` })
            .setTimestamp();
          if (added.size) embed.addFields({ name: 'Added', value: added.map(r => `<@&${r.id}>`).join(', ') });
          if (removed.size) embed.addFields({ name: 'Removed', value: removed.map(r => `<@&${r.id}>`).join(', ') });
          await ch.send({ embeds: [embed] }).catch(() => {});
        }
      }
    },

    userUpdate: async ({ data: [oldUser, newUser], bot, db }) => {
      const usernameChanged = oldUser.username !== newUser.username;
      const avatarChanged = oldUser.avatar !== newUser.avatar;
      if (!usernameChanged && !avatarChanged) return;

      for (const guild of bot.guilds.cache.values()) {
        if (!guild.members.cache.has(newUser.id)) continue;
        const cfg = await db.getLogConfig(guild.id);
        if (!cfg?.log_member_profile) continue;
        const ch = await getLogChannel(bot, resolveChannelId(cfg, 'member'));
        if (!ch) continue;

        if (usernameChanged) {
          const embed = new EmbedBuilder()
            .setColor(Colors.Yellow)
            .setTitle('Username Changed')
            .setThumbnail(newUser.displayAvatarURL())
            .setDescription(`<@${newUser.id}>`)
            .addFields(
              { name: 'Before', value: oldUser.username ?? '*unknown*', inline: true },
              { name: 'After', value: newUser.username, inline: true }
            )
            .setFooter({ text: `ID: ${newUser.id}` })
            .setTimestamp();
          await ch.send({ embeds: [embed] }).catch(() => {});
        }

        if (avatarChanged) {
          const embed = new EmbedBuilder()
            .setColor(Colors.Yellow)
            .setTitle('Avatar Changed')
            .setDescription(`<@${newUser.id}> **${newUser.username}**`)
            .setThumbnail(newUser.displayAvatarURL({ size: 256 }))
            .setFooter({ text: `ID: ${newUser.id}` })
            .setTimestamp();
          await ch.send({ embeds: [embed] }).catch(() => {});
        }
      }
    },

    messageUpdate: async ({ data: [oldMessage, newMessage], bot, db }) => {
      if (!newMessage.guildId || newMessage.author?.bot) return;
      if (oldMessage.content === newMessage.content) return;
      const cfg = await db.getLogConfig(newMessage.guildId);
      if (!cfg?.log_message_edits) return;
      const ignored: string[] = cfg.ignored_channels ? JSON.parse(cfg.ignored_channels) : [];
      if (ignored.includes(newMessage.channelId)) return;
      const ch = await getLogChannel(bot, resolveChannelId(cfg, 'message'));
      if (!ch) return;
      const embed = new EmbedBuilder()
        .setColor(Colors.Yellow)
        .setTitle('Message Edited')
        .setDescription(`<@${newMessage.author?.id}> in <#${newMessage.channelId}>\n[Jump to message](${newMessage.url})`)
        .addFields(
          { name: 'Before', value: (oldMessage.content || '*empty*').slice(0, 1024) },
          { name: 'After', value: (newMessage.content || '*empty*').slice(0, 1024) }
        )
        .setFooter({ text: `User: ${newMessage.author?.id}` })
        .setTimestamp();
      await ch.send({ embeds: [embed] }).catch(() => {});
    },

    messageDelete: async ({ data: [message], bot, db }) => {
      if (!message.guildId || message.author?.bot) return;
      const cfg = await db.getLogConfig(message.guildId);
      if (!cfg?.log_message_deletes) return;
      const ignored: string[] = cfg.ignored_channels ? JSON.parse(cfg.ignored_channels) : [];
      if (ignored.includes(message.channelId)) return;
      const ch = await getLogChannel(bot, resolveChannelId(cfg, 'message'));
      if (!ch) return;

      const guild = message.guild ?? (message.guildId ? bot.guilds.cache.get(message.guildId) : null);
      const deleter = guild && message.author ? await findAuditEntry(guild, AuditLogEvent.MessageDelete, message.author.id) : null;

      const contentValue = message.partial
        ? '*Content unavailable (message wasn\'t cached)*'
        : (message.content || '*(no text content)*').slice(0, 1024);

      const embed = new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle('Message Deleted')
        .setDescription(`<@${message.author?.id}> in <#${message.channelId}>`)
        .addFields(
          { name: 'Content', value: contentValue },
          {
            name: 'Deleted By',
            value: deleter?.executor ? `<@${deleter.executor.id}> (${deleter.executor.tag})` : '*Self-deleted, or deleter unknown*',
            inline: true,
          },
        )
        .setFooter({ text: `Author: ${message.author?.id} · Message: ${message.id}` })
        .setTimestamp();

      if (deleter?.reason) embed.addFields({ name: 'Reason', value: deleter.reason, inline: true });
      if (!message.partial && message.createdTimestamp) {
        embed.addFields({ name: 'Sent', value: `<t:${Math.floor(message.createdTimestamp / 1000)}:R>`, inline: true });
      }
      if (message.attachments.size) {
        embed.addFields({ name: 'Attachments', value: [...message.attachments.values()].map(a => a.name).join(', ').slice(0, 1024) });
      }

      await ch.send({ embeds: [embed] }).catch(() => {});
    },

    messageDeleteBulk: async ({ data: [messages, channel], bot, db }) => {
      const cfg = await db.getLogConfig(channel.guild.id);
      if (!cfg?.log_message_deletes) return;
      const ignored: string[] = cfg.ignored_channels ? JSON.parse(cfg.ignored_channels) : [];
      if (ignored.includes(channel.id)) return;
      const ch = await getLogChannel(bot, resolveChannelId(cfg, 'message'));
      if (!ch) return;

      const deleter = await findAuditEntry(channel.guild, AuditLogEvent.MessageBulkDelete, channel.id);

      const embed = new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle('Messages Bulk Deleted')
        .setDescription(`**${messages.size}** messages deleted in <#${channel.id}>`)
        .addFields({
          name: 'Deleted By',
          value: deleter?.executor ? `<@${deleter.executor.id}> (${deleter.executor.tag})` : '*Unknown (bot or automated action)*',
          inline: true,
        })
        .setTimestamp();

      if (deleter?.reason) embed.addFields({ name: 'Reason', value: deleter.reason, inline: true });

      await ch.send({ embeds: [embed] }).catch(() => {});
    },

    guildBanAdd: async ({ data: [ban], bot, db }) => {
      const cfg = await db.getLogConfig(ban.guild.id);
      if (!cfg?.log_bans) return;
      const ch = await getLogChannel(bot, resolveChannelId(cfg, 'member'));
      if (!ch) return;
      const embed = new EmbedBuilder()
        .setColor(Colors.DarkRed)
        .setTitle('Member Banned')
        .setDescription(`<@${ban.user.id}> **${ban.user.tag}**`)
        .addFields({ name: 'Reason', value: ban.reason ?? 'No reason provided' })
        .setFooter({ text: `ID: ${ban.user.id}` })
        .setTimestamp();
      await ch.send({ embeds: [embed] }).catch(() => {});
    },

    guildBanRemove: async ({ data: [ban], bot, db }) => {
      const cfg = await db.getLogConfig(ban.guild.id);
      if (!cfg?.log_bans) return;
      const ch = await getLogChannel(bot, resolveChannelId(cfg, 'member'));
      if (!ch) return;
      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle('Member Unbanned')
        .setDescription(`<@${ban.user.id}> **${ban.user.tag}**`)
        .setFooter({ text: `ID: ${ban.user.id}` })
        .setTimestamp();
      await ch.send({ embeds: [embed] }).catch(() => {});
    },

    voiceStateUpdate: async ({ data: [oldState, newState], bot, db }) => {
      const guildId = newState.guild?.id ?? oldState.guild?.id;
      if (!guildId) return;
      const cfg = await db.getLogConfig(guildId);
      if (!cfg?.log_voice_events) return;
      const ch = await getLogChannel(bot, resolveChannelId(cfg, 'voice'));
      if (!ch) return;

      const userId = newState.id;
      let embed: EmbedBuilder | null = null;

      if (!oldState.channelId && newState.channelId) {
        embed = new EmbedBuilder()
          .setColor(Colors.Green)
          .setTitle('Joined Voice Channel')
          .setDescription(`<@${userId}> joined <#${newState.channelId}>`)
          .setFooter({ text: `ID: ${userId}` })
          .setTimestamp();
      } else if (oldState.channelId && !newState.channelId) {
        embed = new EmbedBuilder()
          .setColor(Colors.Red)
          .setTitle('Left Voice Channel')
          .setDescription(`<@${userId}> left <#${oldState.channelId}>`)
          .setFooter({ text: `ID: ${userId}` })
          .setTimestamp();
      } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        const fromId = oldState.channelId;
        const toId = newState.channelId;
        embed = new EmbedBuilder()
          .setColor(Colors.Yellow)
          .setTitle('Moved Voice Channel')
          .setDescription(`<@${userId}>`)
          .addFields(
            { name: 'From', value: `<#${fromId}>`, inline: true },
            { name: 'To', value: `<#${toId}>`, inline: true }
          )
          .setFooter({ text: `ID: ${userId}` })
          .setTimestamp();
      }

      if (embed) await ch.send({ embeds: [embed] }).catch(() => {});
    },

    emojiCreate: async ({ data: [emoji], bot, db }) => {
      const cfg = await db.getLogConfig(emoji.guild.id);
      if (!cfg?.log_emoji_changes) return;
      const ch = await getLogChannel(bot, resolveChannelId(cfg, 'server'));
      if (!ch) return;
      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle('Emoji Added')
        .setDescription(`**:${emoji.name}:** ${emoji.toString()}`)
        .setThumbnail(emoji.imageURL())
        .setFooter({ text: `ID: ${emoji.id}` })
        .setTimestamp();
      await ch.send({ embeds: [embed] }).catch(() => {});
    },

    emojiDelete: async ({ data: [emoji], bot, db }) => {
      const cfg = await db.getLogConfig(emoji.guild.id);
      if (!cfg?.log_emoji_changes) return;
      const ch = await getLogChannel(bot, resolveChannelId(cfg, 'server'));
      if (!ch) return;
      const embed = new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle('Emoji Removed')
        .setDescription(`**:${emoji.name}:**`)
        .setThumbnail(emoji.imageURL())
        .setFooter({ text: `ID: ${emoji.id}` })
        .setTimestamp();
      await ch.send({ embeds: [embed] }).catch(() => {});
    },

    emojiUpdate: async ({ data: [oldEmoji, newEmoji], bot, db }) => {
      if (oldEmoji.name === newEmoji.name) return;
      const cfg = await db.getLogConfig(newEmoji.guild.id);
      if (!cfg?.log_emoji_changes) return;
      const ch = await getLogChannel(bot, resolveChannelId(cfg, 'server'));
      if (!ch) return;
      const embed = new EmbedBuilder()
        .setColor(Colors.Yellow)
        .setTitle('Emoji Renamed')
        .setDescription(newEmoji.toString())
        .addFields(
          { name: 'Before', value: `:${oldEmoji.name}:`, inline: true },
          { name: 'After', value: `:${newEmoji.name}:`, inline: true }
        )
        .setFooter({ text: `ID: ${newEmoji.id}` })
        .setTimestamp();
      await ch.send({ embeds: [embed] }).catch(() => {});
    },

    guildUpdate: async ({ data: [oldGuild, newGuild], bot, db }) => {
      const cfg = await db.getLogConfig(newGuild.id);
      if (!cfg?.log_server_updates) return;
      const ch = await getLogChannel(bot, resolveChannelId(cfg, 'server'));
      if (!ch) return;

      const fields: { name: string; value: string; inline?: boolean }[] = [];
      if (oldGuild.name !== newGuild.name)
        fields.push({ name: 'Name', value: `${oldGuild.name} → ${newGuild.name}` });
      if (oldGuild.icon !== newGuild.icon)
        fields.push({ name: 'Icon', value: newGuild.icon ? '[New icon set]' : 'Icon removed' });
      if (oldGuild.description !== newGuild.description)
        fields.push({ name: 'Description', value: `${oldGuild.description ?? '*none*'} → ${newGuild.description ?? '*none*'}` });
      if (oldGuild.verificationLevel !== newGuild.verificationLevel)
        fields.push({ name: 'Verification Level', value: `${oldGuild.verificationLevel} → ${newGuild.verificationLevel}` });
      if (oldGuild.banner !== newGuild.banner)
        fields.push({ name: 'Banner', value: newGuild.banner ? 'Updated' : 'Removed' });

      if (!fields.length) return;
      const embed = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle('Server Updated')
        .addFields(fields)
        .setFooter({ text: `Guild: ${newGuild.id}` })
        .setTimestamp();
      if (newGuild.icon) embed.setThumbnail(newGuild.iconURL());
      await ch.send({ embeds: [embed] }).catch(() => {});
    },

    channelCreate: async ({ data: [channel], bot, db }) => {
      if (!(channel instanceof GuildChannel)) return;
      const cfg = await db.getLogConfig(channel.guild.id);
      if (!cfg?.log_channel_changes) return;
      const ch = await getLogChannel(bot, resolveChannelId(cfg, 'server'));
      if (!ch) return;
      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle('Channel Created')
        .setDescription(`<#${channel.id}> **${channel.name}**`)
        .addFields({ name: 'Type', value: channel.type.toString() })
        .setFooter({ text: `ID: ${channel.id}` })
        .setTimestamp();
      await ch.send({ embeds: [embed] }).catch(() => {});
    },

    channelDelete: async ({ data: [channel], bot, db }) => {
      if (!(channel instanceof GuildChannel)) return;
      const cfg = await db.getLogConfig(channel.guild.id);
      if (!cfg?.log_channel_changes) return;
      const ch = await getLogChannel(bot, resolveChannelId(cfg, 'server'));
      if (!ch) return;
      const embed = new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle('Channel Deleted')
        .setDescription(`**#${channel.name}**`)
        .addFields({ name: 'Type', value: channel.type.toString() })
        .setFooter({ text: `ID: ${channel.id}` })
        .setTimestamp();
      await ch.send({ embeds: [embed] }).catch(() => {});
    },
  },
};

export default logsModule;
