import {
  ActionRowBuilder, ApplicationIntegrationType, ButtonBuilder, ButtonStyle,
  ChannelType, ChatInputCommandInteraction, Colors, ComponentType,
  ContainerBuilder, EmbedBuilder, InteractionContextType, LabelBuilder,
  MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder,
  TextChannel, TextDisplayBuilder, TextInputStyle,
} from 'discord.js';
import * as db from '../../utils/db';
import { Command } from '../../interfaces/command.js';
import { cv2Text } from '../../utils/components.js';
import { findTimezoneMatch, generateTimezoneMessage, offsetToString } from '../../features/timezone/index.js';
import { fetchAllFreeGames } from '../../features/freegames/index.js';

const IS_CV2 = MessageFlags.IsComponentsV2;

const STAT_TYPES = ['members', 'humans', 'bots', 'channels', 'roles'] as const;
type StatType = typeof STAT_TYPES[number];
const STAT_LABELS: Record<StatType, string> = { members: 'Members', humans: 'Humans', bots: 'Bots', channels: 'Channels', roles: 'Roles' };

const TRIGGER_TYPES = ['spam', 'caps', 'links', 'words', 'mentions', 'regex'] as const;
const ACTION_TYPES  = ['delete', 'warn', 'timeout', 'kick', 'ban'] as const;

const PLATFORMS = ['epic', 'steam', 'gog'] as const;
type Platform = typeof PLATFORMS[number];
const PLATFORM_LABELS: Record<Platform, string> = { epic: 'Epic Games Store', steam: 'Steam', gog: 'GOG' };

function parseDuration(s: string): number | null {
  const m = /^(\d+)(m|h|d|w)$/i.exec(s.trim());
  if (!m) return null;
  const n = parseInt(m[1]);
  const units: Record<string, number> = { m: 60, h: 3600, d: 86400, w: 604800 };
  return n * (units[m[2].toLowerCase()] ?? 0) || null;
}
function formatDuration(seconds: number): string {
  if (seconds >= 604800) return `${Math.floor(seconds / 604800)}w`;
  if (seconds >= 86400)  return `${Math.floor(seconds / 86400)}d`;
  if (seconds >= 3600)   return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 60)}m`;
}

const ConfigCommand: Command = {
  data: (new SlashCommandBuilder()
    .setName('config')
    .setDescription('Server configuration')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])

    // ── Counting (direct subcommand — shows modal) ────────────────────────────
    .addSubcommand(s => s
      .setName('counting')
      .setDescription('Configure the counting channel'))

    // ── Streaming ─────────────────────────────────────────────────────────────
    .addSubcommandGroup(g => g.setName('streaming').setDescription('Configure streaming announcements')
      .addSubcommand(s => s.setName('set').setDescription('Configure streaming settings')
        .addChannelOption(o => o.setName('channel').setDescription('Channel for live announcements'))
        .addRoleOption(o => o.setName('role').setDescription('Role to assign while streaming'))
        .addStringOption(o => o.setName('message').setDescription('Announcement message ({username}, {game}, {url})')))
      .addSubcommand(s => s.setName('view').setDescription('View current streaming settings')))

    // ── Starboard ─────────────────────────────────────────────────────────────
    .addSubcommandGroup(g => g.setName('starboard').setDescription('Configure the starboard')
      .addSubcommand(s => s.setName('channel').setDescription('Set the starboard channel')
        .addChannelOption(o => o.setName('channel').setDescription('Where starred messages are posted').setRequired(true)))
      .addSubcommand(s => s.setName('threshold').setDescription('Set minimum reaction count')
        .addIntegerOption(o => o.setName('count').setDescription('Minimum reactions needed').setRequired(true).setMinValue(1).setMaxValue(50)))
      .addSubcommand(s => s.setName('emoji').setDescription('Set the reaction emoji to watch')
        .addStringOption(o => o.setName('emoji').setDescription('Emoji (default ⭐)').setRequired(true)))
      .addSubcommand(s => s.setName('toggle').setDescription('Enable or disable the starboard'))
      .addSubcommand(s => s.setName('view').setDescription('View current starboard settings')))

    // ── Topics ────────────────────────────────────────────────────────────────
    .addSubcommandGroup(g => g.setName('topics').setDescription('Manage automatic discussion topic rotation')
      .addSubcommand(s => s.setName('setup').setDescription('Set up topic rotation for a channel')
        .addChannelOption(o => o.setName('channel').setDescription('Channel to post topics in').setRequired(true))
        .addStringOption(o => o.setName('interval').setDescription('How often to post (e.g. 6h, 1d, 12h)').setRequired(true))
        .addStringOption(o => o.setName('mode').setDescription('Order to cycle')
          .addChoices({ name: 'Sequential (in order)', value: 'sequential' }, { name: 'Random', value: 'random' })))
      .addSubcommand(s => s.setName('remove').setDescription('Stop topic rotation for a channel')
        .addChannelOption(o => o.setName('channel').setDescription('Channel to remove').setRequired(true)))
      .addSubcommand(s => s.setName('add').setDescription('Add a topic to a channel\'s rotation')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true))
        .addStringOption(o => o.setName('topic').setDescription('The discussion topic text').setRequired(true)))
      .addSubcommand(s => s.setName('delete').setDescription('Remove a topic by ID')
        .addIntegerOption(o => o.setName('id').setDescription('Topic ID from /config topics list').setRequired(true)))
      .addSubcommand(s => s.setName('list').setDescription('List topics for a channel')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)))
      .addSubcommand(s => s.setName('post').setDescription('Manually post the next topic now')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true))))

    // ── Timezone ──────────────────────────────────────────────────────────────
    .addSubcommandGroup(g => g.setName('timezone').setDescription('Set and view user timezones')
      .addSubcommand(s => s.setName('set').setDescription('Set your timezone')
        .addStringOption(o => o.setName('timezone').setDescription('Your timezone').setRequired(true).setAutocomplete(true)))
      .addSubcommand(s => s.setName('remove').setDescription('Unset your timezone'))
      .addSubcommand(s => s.setName('view').setDescription('View all timezones in this server')
        .addUserOption(o => o.setName('highlight').setDescription('User to highlight in the list'))))

    // ── Free Games ────────────────────────────────────────────────────────────
    .addSubcommandGroup(g => g.setName('freegames').setDescription('Track and announce free game promotions')
      .addSubcommand(s => s.setName('setup').setDescription('Set up the free game tracker')
        .addChannelOption(o => o.setName('channel').setDescription('Channel to post alerts').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addRoleOption(o => o.setName('ping').setDescription('Role to ping for new free games')))
      .addSubcommand(s => s.setName('platforms').setDescription('Choose which platforms to track')
        .addBooleanOption(o => o.setName('epic').setDescription('Track Epic Games Store'))
        .addBooleanOption(o => o.setName('steam').setDescription('Track Steam'))
        .addBooleanOption(o => o.setName('gog').setDescription('Track GOG')))
      .addSubcommand(s => s.setName('ping').setDescription('Set or clear the ping role')
        .addRoleOption(o => o.setName('role').setDescription('Role to ping (leave blank to clear)')))
      .addSubcommand(s => s.setName('disable').setDescription('Disable the free game tracker'))
      .addSubcommand(s => s.setName('view').setDescription('View tracker settings'))
      .addSubcommand(s => s.setName('check').setDescription('Check for free games now and post any new ones')))

    // ── Server Stats ──────────────────────────────────────────────────────────
    .addSubcommandGroup(g => g.setName('serverstats').setDescription('Server statistics and stat channels')
      .addSubcommand(s => s.setName('view').setDescription('View server activity stats')
        .addIntegerOption(o => o.setName('hours').setDescription('Hours to look back (default 24, max 168)').setMinValue(1).setMaxValue(168)))
      .addSubcommand(s => s.setName('add').setDescription('Create an auto-updating stat channel')
        .addStringOption(o => o.setName('type').setDescription('What stat to display').setRequired(true)
          .addChoices(...STAT_TYPES.map(t => ({ name: STAT_LABELS[t], value: t }))))
        .addStringOption(o => o.setName('label').setDescription('Label prefix (defaults to stat type name)')))
      .addSubcommand(s => s.setName('remove').setDescription('Remove a stat channel')
        .addIntegerOption(o => o.setName('id').setDescription('ID from /config serverstats list').setRequired(true)))
      .addSubcommand(s => s.setName('list').setDescription('List all stat channels')))
  ) as any,

  async run(interaction: ChatInputCommandInteraction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub   = interaction.options.getSubcommand();

    // ── Counting ──────────────────────────────────────────────────────────────
    if (!group && sub === 'counting') {
      if (!interaction.channel) return;
      const count = await db.getCounting(interaction.channel.id);
      const modal = new ModalBuilder()
        .setTitle('Counting')
        .setCustomId(`counting_modal:${interaction.channel.id}`)
        .addTextDisplayComponents(new TextDisplayBuilder({
          content:
            `Configure the counting channel <#${interaction.channel.id}>:\n` +
            (count
              ? `-# The current count is **${count.count.toLocaleString()}** with a high score of **${(count.highscore ?? count.count).toLocaleString()}**.`
              : `-# This channel is not a counting channel yet. Use the form below to set it up!`),
        }))
        .addLabelComponents(
          new LabelBuilder({
            label: 'Current Count',
            description: 'Set the current count',
            component: { type: ComponentType.TextInput, custom_id: 'current_count', max_length: 10, min_length: 1, style: TextInputStyle.Short, required: !!count, value: count?.count?.toLocaleString() ?? undefined, placeholder: count?.count?.toLocaleString() ?? '0' },
          }),
          new LabelBuilder({
            label: 'High Score',
            description: 'Set the high score',
            component: { type: ComponentType.TextInput, custom_id: 'high_score', max_length: 10, min_length: 1, style: TextInputStyle.Short, required: false, value: count?.highscore?.toLocaleString() ?? undefined, placeholder: count?.highscore?.toLocaleString() ?? '0' },
          }),
          ...(count ? [new LabelBuilder({ label: 'Disable Counting', description: 'Stop counting and reset data', component: { type: ComponentType.Checkbox, custom_id: 'reset_messages', default: false } })] : [])
        );
      await interaction.showModal(modal);
      return;
    }

    // ── Streaming ─────────────────────────────────────────────────────────────
    if (group === 'streaming') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (sub === 'set') {
        const channel = interaction.options.getChannel('channel');
        const role    = interaction.options.getRole('role');
        const message = interaction.options.getString('message');
        await db.setStreamingConfig(interaction.guildId!, { announce_channel_id: channel?.id, give_role_id: role?.id, message: message ?? undefined });
        await interaction.editReply('✅ Streaming config updated.');
      } else {
        const cfg = await db.getStreamingConfig(interaction.guildId!);
        if (!cfg) { await interaction.editReply('Streaming not configured yet.'); return; }
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(Colors.Purple).setTitle('Streaming Config').addFields(
          { name: 'Announce Channel', value: cfg.announce_channel_id ? `<#${cfg.announce_channel_id}>` : 'Not set', inline: true },
          { name: 'Streaming Role',  value: cfg.give_role_id ? `<@&${cfg.give_role_id}>` : 'Not set', inline: true },
          { name: 'Message Template', value: cfg.message },
        )] });
      }
      return;
    }

    // ── Starboard ─────────────────────────────────────────────────────────────
    if (group === 'starboard') {
      const config = await db.getStarboardConfig(interaction.guildId!);
      if (sub === 'channel') {
        const channel = interaction.options.getChannel('channel', true);
        await db.setStarboardConfig(interaction.guildId!, { channel_id: channel.id });
        return interaction.reply({ content: `✅ Starboard channel set to <#${channel.id}>.`, flags: MessageFlags.Ephemeral });
      }
      if (sub === 'threshold') {
        const count = interaction.options.getInteger('count', true);
        await db.setStarboardConfig(interaction.guildId!, { threshold: count });
        return interaction.reply({ content: `✅ Starboard threshold set to **${count}** reactions.`, flags: MessageFlags.Ephemeral });
      }
      if (sub === 'emoji') {
        const emoji = interaction.options.getString('emoji', true).trim();
        await db.setStarboardConfig(interaction.guildId!, { emoji });
        return interaction.reply({ content: `✅ Starboard emoji set to ${emoji}.`, flags: MessageFlags.Ephemeral });
      }
      if (sub === 'toggle') {
        const newState = config ? !config.enabled : true;
        await db.setStarboardConfig(interaction.guildId!, { enabled: newState ? 1 : 0 });
        return interaction.reply({ content: `✅ Starboard is now **${newState ? 'enabled' : 'disabled'}**.`, flags: MessageFlags.Ephemeral });
      }
      if (sub === 'view') {
        return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [new EmbedBuilder().setColor(Colors.Yellow).setTitle('⭐ Starboard Config').addFields(
          { name: 'Status',    value: config?.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
          { name: 'Channel',   value: config?.channel_id ? `<#${config.channel_id}>` : 'Not set', inline: true },
          { name: 'Emoji',     value: config?.emoji ?? '⭐', inline: true },
          { name: 'Threshold', value: `${config?.threshold ?? 3} reactions`, inline: true },
        )] });
      }
      return;
    }

    // ── Topics ────────────────────────────────────────────────────────────────
    if (group === 'topics') {
      const guild = interaction.guild!;
      if (sub === 'setup') {
        const channel = interaction.options.getChannel('channel', true);
        const intervalStr = interaction.options.getString('interval', true);
        const mode = (interaction.options.getString('mode') ?? 'sequential') as 'sequential' | 'random';
        const seconds = parseDuration(intervalStr);
        if (!seconds) return interaction.reply({ content: 'Invalid interval. Use formats like `6h`, `1d`, `30m`.', flags: MessageFlags.Ephemeral });
        await db.setTopicChannel(guild.id, channel.id, seconds, mode);
        return interaction.reply({ content: `✅ Topic rotation set up for <#${channel.id}> every **${formatDuration(seconds)}** (${mode} mode).\nAdd topics with \`/config topics add\`.`, flags: MessageFlags.Ephemeral });
      }
      if (sub === 'remove') {
        const channel = interaction.options.getChannel('channel', true);
        await db.removeTopicChannel(guild.id, channel.id);
        return interaction.reply({ content: `✅ Topic rotation removed from <#${channel.id}>.`, flags: MessageFlags.Ephemeral });
      }
      if (sub === 'add') {
        const channel = interaction.options.getChannel('channel', true);
        const text = interaction.options.getString('topic', true);
        const tc = await db.getTopicChannel(guild.id, channel.id);
        if (!tc) return interaction.reply({ content: `<#${channel.id}> is not set up yet. Use \`/config topics setup\` first.`, flags: MessageFlags.Ephemeral });
        const topic = await db.addTopic(guild.id, channel.id, text);
        return interaction.reply({ content: `✅ Topic added (ID: **${topic.id}**).`, flags: MessageFlags.Ephemeral });
      }
      if (sub === 'delete') {
        const id = interaction.options.getInteger('id', true);
        const removed = await db.removeTopic(id, guild.id);
        if (!removed) return interaction.reply({ content: 'No topic found with that ID.', flags: MessageFlags.Ephemeral });
        return interaction.reply({ content: '✅ Topic removed.', flags: MessageFlags.Ephemeral });
      }
      if (sub === 'list') {
        const channel = interaction.options.getChannel('channel', true);
        const tc = await db.getTopicChannel(guild.id, channel.id);
        const topics = await db.getTopics(guild.id, channel.id);
        if (!tc) return interaction.reply({ content: `<#${channel.id}> has no topic rotation configured.`, flags: MessageFlags.Ephemeral });
        const embed = new EmbedBuilder().setColor(Colors.Blurple).setTitle(`💬 Topics for #${(guild.channels.cache.get(channel.id) as any)?.name ?? channel.id}`)
          .addFields(
            { name: 'Interval', value: formatDuration(tc.interval_seconds), inline: true },
            { name: 'Mode', value: tc.mode, inline: true },
            { name: 'Last Posted', value: tc.last_posted ? `<t:${Math.floor(tc.last_posted / 1000)}:R>` : 'Never', inline: true },
          )
          .setDescription(topics.length ? topics.map(t => `**#${t.id}** ${t.text}`).join('\n') : 'No topics added yet.');
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
      if (sub === 'post') {
        const channel = interaction.options.getChannel('channel', true);
        const tc = await db.getTopicChannel(guild.id, channel.id);
        if (!tc) return interaction.reply({ content: `<#${channel.id}> is not set up for topic rotation.`, flags: MessageFlags.Ephemeral });
        const topic = await db.getNextTopic(guild.id, channel.id, tc.mode);
        if (!topic) return interaction.reply({ content: 'No topics added yet. Use `/config topics add`.', flags: MessageFlags.Ephemeral });
        const ch = guild.channels.cache.get(channel.id) as any;
        if (!ch?.isTextBased()) return interaction.reply({ content: 'Channel not found or not a text channel.', flags: MessageFlags.Ephemeral });
        await ch.send({ embeds: [new EmbedBuilder().setColor(Colors.Blurple).setTitle('💬 Discussion Topic').setDescription(topic.text).setTimestamp()] });
        await db.updateTopicLastPosted(tc.id);
        if (tc.mode === 'sequential') await db.rotateTopic(guild.id, channel.id);
        return interaction.reply({ content: `✅ Topic posted in <#${channel.id}>.`, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    // ── Timezone ──────────────────────────────────────────────────────────────
    if (group === 'timezone') {
      const guildId = interaction.guildId!;

      const updateTimezoneMessage = async () => {
        const timezoneMsg = await db.getGuildTimezoneMessage(guildId);
        if (!timezoneMsg) return;
        const channel = await interaction.guild!.channels.fetch(timezoneMsg.channel_id);
        if (!channel || !channel.isTextBased()) return;
        const message = await (channel as any).messages.fetch(timezoneMsg.message_id);
        const newContent = await generateTimezoneMessage(db, guildId, null);
        if (!newContent) return;
        await message.edit({ content: newContent.content, components: newContent.components, allowedMentions: { parse: [] } });
      };

      if (sub === 'set') {
        const timezoneInput = interaction.options.getString('timezone', true);
        const match = findTimezoneMatch(timezoneInput);
        if (!match) {
          return interaction.reply({ content: `❌ Invalid timezone. Use the autocomplete to pick one.`, flags: MessageFlags.Ephemeral });
        }
        await db.setUserTimezone(guildId, interaction.user.id, match.name);
        await interaction.reply({ content: `✅ Your timezone has been set to **${match.displayName}**\n-# (Offset: \`${offsetToString(match.offset)}\`${match.hasDST ? ', observes DST' : ''})` });
        await updateTimezoneMessage();
      } else if (sub === 'remove') {
        const removed = await db.removeUserTimezone(guildId, interaction.user.id);
        if (removed) {
          await interaction.reply({ content: `🗑️ Your timezone setting has been removed.`, flags: MessageFlags.Ephemeral });
          await updateTimezoneMessage();
        } else {
          await interaction.reply({ content: `ℹ️ You didn't have a timezone set.`, flags: MessageFlags.Ephemeral });
        }
      } else if (sub === 'view') {
        const highlightUser = interaction.options.getUser('highlight');
        const userid = highlightUser?.id ?? interaction.user.id;
        const result = await generateTimezoneMessage(db, guildId, userid);
        if (!result) {
          return interaction.reply({ content: `ℹ️ No members have set a timezone yet. Use \`/config timezone set\` to get started.`, flags: MessageFlags.Ephemeral });
        }
        await interaction.reply({ ...result, allowedMentions: {} });
      }
      return;
    }

    // ── Free Games ────────────────────────────────────────────────────────────
    if (group === 'freegames') {
      const guildId = interaction.guildId!;
      if (sub === 'setup') {
        const channel = interaction.options.getChannel('channel', true);
        const ping    = interaction.options.getRole('ping');
        await (db as any).setFreeGameConfig(guildId, { channel_id: channel.id, platforms: JSON.stringify(PLATFORMS), ...(ping !== null ? { ping_role_id: ping.id } : {}) });
        return interaction.reply({ content: `✅ Free game tracker enabled. Alerts → <#${channel.id}>${ping ? ` | Ping: <@&${ping.id}>` : ''}.\nUse \`/config freegames platforms\` to toggle platforms.`, flags: MessageFlags.Ephemeral });
      }
      if (sub === 'platforms') {
        const config = await (db as any).getFreeGameConfig(guildId);
        if (!config?.channel_id) { return interaction.reply({ content: '❌ Set up the tracker first with `/config freegames setup`.', flags: MessageFlags.Ephemeral }); }
        const current: Platform[] = JSON.parse(config.platforms);
        const epic  = interaction.options.getBoolean('epic');
        const steam = interaction.options.getBoolean('steam');
        const gog   = interaction.options.getBoolean('gog');
        const updated = PLATFORMS.filter(p => {
          if (p === 'epic'  && epic  !== null) return epic;
          if (p === 'steam' && steam !== null) return steam;
          if (p === 'gog'   && gog   !== null) return gog;
          return current.includes(p);
        });
        if (!updated.length) { return interaction.reply({ content: '❌ At least one platform must be enabled.', flags: MessageFlags.Ephemeral }); }
        await (db as any).setFreeGameConfig(guildId, { platforms: JSON.stringify(updated) });
        return interaction.reply({ content: `✅ Now tracking: **${updated.map(p => PLATFORM_LABELS[p]).join(', ')}**.`, flags: MessageFlags.Ephemeral });
      }
      if (sub === 'ping') {
        const config = await (db as any).getFreeGameConfig(guildId);
        if (!config?.channel_id) { return interaction.reply({ content: '❌ Set up first with `/config freegames setup`.', flags: MessageFlags.Ephemeral }); }
        const role = interaction.options.getRole('role');
        await (db as any).setFreeGameConfig(guildId, { ping_role_id: role?.id ?? null });
        return interaction.reply({ content: role ? `✅ Will ping <@&${role.id}> for new free games.` : '✅ Ping role cleared.', flags: MessageFlags.Ephemeral });
      }
      if (sub === 'disable') {
        await (db as any).setFreeGameConfig(guildId, { channel_id: null });
        return interaction.reply({ content: '✅ Free game tracker disabled.', flags: MessageFlags.Ephemeral });
      }
      if (sub === 'view') {
        const config = await (db as any).getFreeGameConfig(guildId);
        if (!config?.channel_id) { return interaction.reply({ content: 'Not configured. Use `/config freegames setup` to get started.', flags: MessageFlags.Ephemeral }); }
        const platforms: Platform[] = JSON.parse(config.platforms);
        return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [new EmbedBuilder().setColor(Colors.Gold).setTitle('🎮 Free Game Tracker')
          .addFields(
            { name: 'Channel',   value: `<#${config.channel_id}>`, inline: true },
            { name: 'Ping Role', value: config.ping_role_id ? `<@&${config.ping_role_id}>` : 'None', inline: true },
            { name: 'Platforms', value: platforms.map(p => PLATFORM_LABELS[p]).join(', '), inline: true },
          ).setFooter({ text: 'Checks for new free games every hour.' })] });
      }
      if (sub === 'check') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const config = await (db as any).getFreeGameConfig(guildId);
        if (!config?.channel_id) { await interaction.editReply('❌ Set up first with `/config freegames setup`.'); return; }
        const platforms: Platform[] = JSON.parse(config.platforms);
        const games = await fetchAllFreeGames();
        const filtered = games.filter(g => platforms.includes(g.id.split(':')[0] as Platform));
        if (!filtered.length) { await interaction.editReply('No free games detected right now.'); return; }
        const channel = interaction.client.channels.cache.get(config.channel_id) as TextChannel | undefined;
        if (!channel) { await interaction.editReply('❌ Configured channel is not accessible.'); return; }
        let posted = 0, skipped = 0;
        for (const game of filtered) {
          if (await (db as any).hasFreeGameBeenPosted(guildId, game.id)) { skipped++; continue; }
          const embed = new EmbedBuilder().setColor(Colors.Gold).setTitle(`🎮 Free on ${game.platform}: ${game.title}`).setURL(game.url).setDescription(game.description ?? `**${game.title}** is currently free on ${game.platform}!`).setFooter({ text: game.platform });
          if (game.image) embed.setImage(game.image);
          const fields: any[] = [];
          if (game.originalPrice) fields.push({ name: 'Normal Price', value: `~~${game.originalPrice}~~  →  **FREE**`, inline: true });
          if (game.endDate) fields.push({ name: 'Free Until', value: `<t:${Math.floor(new Date(game.endDate).getTime() / 1000)}:F>`, inline: true });
          if (fields.length) embed.addFields(fields);
          const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel('Claim Free Game').setStyle(ButtonStyle.Link).setURL(game.url).setEmoji('🎮'));
          await channel.send({ content: config.ping_role_id ? `<@&${config.ping_role_id}>` : undefined, embeds: [embed], components: [row] }).catch(() => {});
          await (db as any).markFreeGamePosted(guildId, game.id);
          posted++;
        }
        await interaction.editReply(posted > 0 ? `✅ Posted **${posted}** new free game${posted !== 1 ? 's' : ''} to <#${config.channel_id}>.${skipped > 0 ? ` (${skipped} already posted)` : ''}` : `All ${skipped} current free game${skipped !== 1 ? 's' : ''} were already posted.`);
      }
      return;
    }

    // ── Server Stats ──────────────────────────────────────────────────────────
    if (group === 'serverstats') {
      const guild = interaction.guild!;
      if (sub === 'view') {
        const hours = interaction.options.getInteger('hours') ?? 24;
        await interaction.deferReply();
        const stats = await db.getServerStats(interaction.guildId!, hours);
        const totals = stats.reduce((acc, s) => ({ messages: acc.messages + s.messages, joins: acc.joins + s.joins, leaves: acc.leaves + s.leaves }), { messages: 0, joins: 0, leaves: 0 });
        await interaction.editReply({ flags: IS_CV2, components: [new ContainerBuilder().setAccentColor(Colors.Blue).addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `**Server Stats — Last ${hours}h**\n\n💬 **Messages:** ${totals.messages.toLocaleString()}\n➕ **Joins:** ${totals.joins.toLocaleString()}\n➖ **Leaves:** ${totals.leaves.toLocaleString()}\n👥 **Current Members:** ${guild.memberCount.toLocaleString()}`
        ))] });
      } else if (sub === 'add') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) { await interaction.reply({ ...cv2Text('❌ You need **Manage Server** to manage stat channels.'), flags: IS_CV2 | MessageFlags.Ephemeral }); return; }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const type  = interaction.options.getString('type', true) as StatType;
        const label = interaction.options.getString('label') ?? STAT_LABELS[type];
        const channel = await guild.channels.create({ name: `${label}: 0`, type: ChannelType.GuildVoice, permissionOverwrites: [{ id: guild.roles.everyone, deny: ['Connect'] }, { id: interaction.client.user!.id, allow: ['ManageChannels', 'Connect'] }] });
        await db.addStatChannel(guild.id, channel.id, type, label);
        await interaction.editReply(cv2Text(`✅ Created stat channel <#${channel.id}>. It will update every 10 minutes.`));
      } else if (sub === 'remove') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) { await interaction.reply({ ...cv2Text('❌ You need **Manage Server** to manage stat channels.'), flags: IS_CV2 | MessageFlags.Ephemeral }); return; }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const id  = interaction.options.getInteger('id', true);
        const all = await db.getStatChannels(guild.id);
        const sc  = all.find(s => s.id === id);
        if (!sc) { await interaction.editReply(cv2Text('No stat channel found with that ID.')); return; }
        await db.removeStatChannelById(id, guild.id);
        const ch = guild.channels.cache.get(sc.channel_id);
        if (ch) await ch.delete().catch(() => {});
        await interaction.editReply(cv2Text('✅ Stat channel removed.'));
      } else if (sub === 'list') {
        const all = await db.getStatChannels(guild.id);
        if (!all.length) { await interaction.reply({ ...cv2Text('No stat channels configured.'), flags: IS_CV2 | MessageFlags.Ephemeral }); return; }
        await interaction.reply({ flags: IS_CV2 | MessageFlags.Ephemeral, components: [new ContainerBuilder().setAccentColor(Colors.Blue).addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `**📊 Stat Channels**\n\n${all.map(s => `**ID ${s.id}** — <#${s.channel_id}> (${s.type})`).join('\n')}`
        ))] });
      }
    }
  },
};

export default ConfigCommand;
