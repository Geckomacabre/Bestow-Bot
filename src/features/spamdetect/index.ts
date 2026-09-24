import { ChatInputCommandInteraction, EmbedBuilder, GuildMember, Message, TextChannel, PermissionFlagsBits } from 'discord.js';
import { EventModule } from '../feature';
import { getLogConfig } from '../../utils/db.js';

const WINDOW_MS = 30_000;       // 30-second sliding window for cross-channel image spam
const THRESHOLD = 3;            // more than 3 channels triggers action
// The same-message/same-link cross-channel check gets its own window and
// threshold — it's the exact fingerprint of a hijacked or malicious account
// running a scam (a fake giveaway link posted in a bunch of channels), so
// it's tuned wider than the image check to catch a campaign that takes its
// time, and — unlike every other check here — it is NEVER skipped for
// trusted accounts. See messageCreate below for why.
const CROSS_CHANNEL_WINDOW_MS = 45_000;
const CROSS_CHANNEL_MIN_CHANNELS = 3; // identical text/link in 3+ channels — nothing legitimate does this
const URL_RE = /https?:\/\/[^\s<>]+/gi;
// Two separate signals for same-channel flooding, so a fast typer sending several
// *different* real messages isn't treated the same as a bot/paste spamming one line
// over and over. Either one firing is enough to punish.
const RAPID_WINDOW_MS = 6_000;      // window for the raw flood-rate safety net
const RAPID_THRESHOLD = 8;          // 8+ messages in 6s — not achievable by hand typing distinct content
const DUPLICATE_WINDOW_MS = 10_000; // window for repeated-content detection
const DUPLICATE_THRESHOLD = 4;      // the *same* message 4+ times — the actual signature of spam
const CMD_RAPID_WINDOW_MS = 8_000; // 8-second window for rapid slash-command usage
const CMD_RAPID_THRESHOLD = 6;     // 6+ commands in 8 seconds — normal users don't do this, raid scripts do
const MSG_HISTORY_MS = 60 * 1000; // 1 minute — how far back to purge on spam
const TIMEOUT_MS = 24 * 60 * 60 * 1000;

type TrackedMsg = { id: string; channelId: string; timestamp: number; content: string };
type TrackedContent = { content: string; timestamp: number };

type UserTrack = {
  imageChannels: Map<string, number>;
  messageChannels: Map<string, Set<string>>;
  recentMessages: number[];
  recentContents: TrackedContent[];
  recentCommands: number[];
  msgHistory: TrackedMsg[];
};

// guildId -> userId -> track
const tracker = new Map<string, Map<string, UserTrack>>();

function getTrack(guildId: string, userId: string): UserTrack {
  if (!tracker.has(guildId)) tracker.set(guildId, new Map());
  const guild = tracker.get(guildId)!;
  if (!guild.has(userId)) guild.set(userId, { imageChannels: new Map(), messageChannels: new Map(), recentMessages: [], recentContents: [], recentCommands: [], msgHistory: [] });
  return guild.get(userId)!;
}

function pruneWindow(map: Map<string, number>, now: number) {
  for (const [k, ts] of map) {
    if (now - ts > WINDOW_MS) map.delete(k);
  }
}

async function purgeHistory(member: GuildMember, history: TrackedMsg[]): Promise<TrackedMsg[]> {
  const cutoff = Date.now() - MSG_HISTORY_MS;
  const toDelete = history.filter(m => m.timestamp >= cutoff);

  // group by channel
  const byChannel = new Map<string, string[]>();
  for (const m of toDelete) {
    if (!byChannel.has(m.channelId)) byChannel.set(m.channelId, []);
    byChannel.get(m.channelId)!.push(m.id);
  }

  const deleted: TrackedMsg[] = [];
  for (const [channelId, ids] of byChannel) {
    try {
      const ch = await member.guild.channels.fetch(channelId) as TextChannel;
      // bulkDelete requires 2–100 messages; handle singles separately
      if (ids.length === 1) {
        await ch.messages.delete(ids[0]!).catch(() => {});
        deleted.push(toDelete.find(m => m.id === ids[0])!);
      } else {
        const chunks = [];
        for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
        for (const chunk of chunks) {
          const res = await ch.bulkDelete(chunk, true).catch(() => null);
          if (res) {
            for (const id of res.keys()) {
              const m = toDelete.find(t => t.id === id);
              if (m) deleted.push(m);
            }
          }
        }
      }
    } catch {}
  }

  return deleted;
}

// Flattens whitespace, escapes backticks, and truncates for safe display inside
// a code span in an embed. Attachment-only messages have no text.
function sanitizeForLog(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  if (!flat) return '*(no text — attachment/embed only)*';
  const clipped = flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
  return `\`${clipped.replace(/`/g, "'")}\``;
}

async function punish(
  member: GuildMember,
  reason: string,
  db: any,
  msgHistory: TrackedMsg[],
) {
  const guildId = member.guild.id;

  // timeout
  try {
    if (member.moderatable) await member.timeout(TIMEOUT_MS, reason);
  } catch {}

  // purge last hour of messages
  const deleted = await purgeHistory(member, msgHistory);

  // A representative message to show in the summary embeds — most recent one
  // that actually has text (falls back to the newest overall if all were
  // attachment-only).
  const sample = [...deleted].sort((a, b) => b.timestamp - a.timestamp).find(m => m.content.trim().length > 0) ?? deleted[deleted.length - 1];
  const sampleField = sample
    ? [{ name: 'Sample Message', value: sanitizeForLog(sample.content) }]
    : [];

  const [logCfg, modCfg] = await Promise.all([
    getLogConfig(guildId),
    db.getModConfig(guildId),
  ]);

  // ── Member log ───────────────────────────────────────────────────────────────
  const memberLogId = logCfg?.member_log_channel_id ?? modCfg?.modlog_channel_id;
  if (memberLogId) {
    try {
      const ch = await member.guild.channels.fetch(memberLogId) as TextChannel;
      const embed = new EmbedBuilder()
        .setColor(0xFF4444)
        .setTitle('🚨 Spam Detected — Auto Timeout')
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
          { name: 'User', value: `<@${member.id}> (${member.user.tag})`, inline: true },
          { name: 'Action', value: '24-hour timeout', inline: true },
          { name: 'Reason', value: reason },
          { name: 'Messages Purged', value: `${deleted.length} messages deleted (last hour)`, inline: true },
          ...sampleField,
        )
        .setTimestamp();
      await ch.send({ embeds: [embed] });
    } catch {}
  }

  // ── Message log — list deleted messages ──────────────────────────────────────
  const msgLogId = logCfg?.message_log_channel_id;
  if (msgLogId && deleted.length > 0) {
    try {
      const ch = await member.guild.channels.fetch(msgLogId) as TextChannel;

      // Build a summary; Discord embed values max 1024 chars each
      const lines = deleted
        .sort((a, b) => a.timestamp - b.timestamp)
        .map(m => `<t:${Math.floor(m.timestamp / 1000)}:T> <#${m.channelId}> — ${sanitizeForLog(m.content)}`)
        .join('\n');

      const truncated = lines.length > 4000 ? lines.slice(0, 4000) + '\n…(truncated)' : lines;

      const embed = new EmbedBuilder()
        .setColor(0xFF8800)
        .setTitle(`🗑️ ${deleted.length} Messages Deleted — Spam Purge`)
        .setDescription(`**User:** <@${member.id}> (${member.user.tag})\n**Reason:** ${reason}\n\n${truncated}`)
        .setTimestamp();
      await ch.send({ embeds: [embed] });
    } catch {}
  }

  // ── Modlog (existing) ─────────────────────────────────────────────────────────
  if (modCfg?.modlog_channel_id && modCfg.modlog_channel_id !== memberLogId) {
    try {
      const modCh = await member.guild.channels.fetch(modCfg.modlog_channel_id) as TextChannel;
      const embed = new EmbedBuilder()
        .setColor(0xFF4444)
        .setTitle('🚨 Spam Detected — User Timed Out')
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
          { name: 'User', value: `<@${member.id}> (${member.user.tag})`, inline: true },
          { name: 'Action', value: '24-hour timeout', inline: true },
          { name: 'Reason', value: reason },
          ...sampleField,
        )
        .setTimestamp();
      await modCh.send({ content: `🚨 Spam detected — please review <@${member.id}>.`, embeds: [embed] });
    } catch {}
  }
}

// Called from onInteraction.ts for every chat command — not a ClientEvents event,
// so it's a plain exported function rather than an EventModule handler. A raid
// script hammering slash commands trips the same timeout+purge+log pipeline as
// message spam. Returns true if the user was just punished (caller should abort).
export async function checkCommandSpam(interaction: ChatInputCommandInteraction, db: any): Promise<boolean> {
  if (!interaction.guildId) return false;
  const member = interaction.member as GuildMember | null;
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return false;

  const now = Date.now();
  const track = getTrack(interaction.guildId, interaction.user.id);
  track.recentCommands.push(now);
  track.recentCommands = track.recentCommands.filter(ts => now - ts <= CMD_RAPID_WINDOW_MS);

  if (track.recentCommands.length < CMD_RAPID_THRESHOLD) return false;

  const count = track.recentCommands.length;
  const history = [...track.msgHistory];
  track.recentCommands = [];
  track.msgHistory = [];
  await punish(member, `Command spam: ${count} slash commands in ${CMD_RAPID_WINDOW_MS / 1000} seconds`, db, history);
  return true;
}

const spamDetectModule: EventModule = {
  name: 'spamdetect',
  handlers: {
    messageCreate: async ({ data: [message], bot, db }) => {
      const msg = message as Message;
      if (!msg.guildId || msg.author.id === bot.user?.id) return; // never police the bot itself

      const member = msg.member as GuildMember | null;
      if (!member) return;

      // Manage Messages holders (staff, or a bot granted that role) skip the
      // noisier same-channel checks below — those are more prone to false
      // positives, so trusting elevated roles there is reasonable. They are
      // NOT exempt from the cross-channel check further down: identical text
      // or an identical link posted across several channels is never a
      // legitimate action, no matter who's doing it. A previous version of
      // this file exempted every bot-flagged account AND every Manage
      // Messages holder from all of this — meaning a hijacked account with
      // staff permissions, or a malicious/compromised bot, could spam a scam
      // link across the whole server with zero detection. This closes that.
      const trusted = member.permissions.has(PermissionFlagsBits.ManageMessages);

      const now = Date.now();
      const track = getTrack(msg.guildId, msg.author.id);
      const channelId = msg.channelId;

      // Track every message for history-based purge (keep last hour)
      track.msgHistory.push({ id: msg.id, channelId, timestamp: now, content: msg.content ?? '' });
      track.msgHistory = track.msgHistory.filter(m => now - m.timestamp <= MSG_HISTORY_MS);

      if (!trusted) {
        // ── Rapid-fire / repeated-content detection ────────────────────────────
        // Raw flood rate is a safety net (an enthusiastic person typing distinct
        // messages back to back can hit 3-4 in a few seconds — that's not spam).
        // The stronger signal is the *same* message posted over and over, which is
        // what real spam bots and copy-paste raids actually do.
        track.recentMessages.push(now);
        track.recentMessages = track.recentMessages.filter(ts => now - ts <= RAPID_WINDOW_MS);

        const normalizedContent = msg.content.trim().toLowerCase().replace(/\s+/g, ' ');
        track.recentContents.push({ content: normalizedContent, timestamp: now });
        track.recentContents = track.recentContents.filter(c => now - c.timestamp <= DUPLICATE_WINDOW_MS);
        const duplicateCount = normalizedContent.length >= 2
          ? track.recentContents.filter(c => c.content === normalizedContent).length
          : 0;

        const isFlooding = track.recentMessages.length >= RAPID_THRESHOLD;
        const isRepeating = duplicateCount >= DUPLICATE_THRESHOLD;

        if (isFlooding || isRepeating) {
          const reason = isRepeating
            ? `Repeated-message spam: sent the same message ${duplicateCount} times within ${DUPLICATE_WINDOW_MS / 1000} seconds`
            : `Rapid-fire spam: ${track.recentMessages.length} messages in ${RAPID_WINDOW_MS / 1000} seconds`;
          const history = [...track.msgHistory];
          track.recentMessages = [];
          track.recentContents = [];
          track.msgHistory = [];
          await punish(member, reason, db, history);
          return;
        }

        // ── Image spam detection ───────────────────────────────────────────────
        const hasImage = msg.attachments.some(a =>
          a.contentType?.startsWith('image/') || a.contentType?.startsWith('video/')
        ) || msg.embeds.some(e => e.image || e.video || e.thumbnail);

        if (hasImage) {
          pruneWindow(track.imageChannels, now);
          if (!track.imageChannels.has(channelId)) {
            track.imageChannels.set(channelId, now);
          }
          if (track.imageChannels.size > THRESHOLD) {
            const channelList = [...track.imageChannels.keys()].map(id => `<#${id}>`).join(', ');
            const history = [...track.msgHistory];
            track.imageChannels.clear();
            track.msgHistory = [];
            await punish(member, `Image spam: posted images in ${channelList} within ${WINDOW_MS / 1000} seconds`, db, history);
            return;
          }
        }
      }

      // ── Same-message / same-link cross-channel spam detection ───────────────
      // Applies to everyone, no exceptions — see the comment on `trusted` above.
      // Tracks both the exact message text AND any URLs found in it separately,
      // so a scam script that varies the surrounding wording per channel but
      // reuses the same link still gets caught.
      const content = msg.content.trim().toLowerCase();
      const urls = content.match(URL_RE) ?? [];
      const keys = [content.length >= 3 ? content : null, ...urls].filter((k): k is string => !!k);

      for (const key of keys) {
        if (!track.messageChannels.has(key)) track.messageChannels.set(key, new Set());
        const channels = track.messageChannels.get(key)!;
        channels.add(channelId);

        setTimeout(() => {
          const t = tracker.get(msg.guildId!)?.get(msg.author.id);
          const ch = t?.messageChannels.get(key);
          if (ch) {
            ch.delete(channelId);
            if (ch.size === 0) t!.messageChannels.delete(key);
          }
        }, CROSS_CHANNEL_WINDOW_MS);

        if (channels.size >= CROSS_CHANNEL_MIN_CHANNELS) {
          const channelList = [...channels].map(id => `<#${id}>`).join(', ');
          const history = [...track.msgHistory];
          track.messageChannels.clear();
          track.msgHistory = [];
          const kind = key === content ? 'message' : 'link';
          await punish(member, `Message spam: sent the same ${kind} in ${channelList} within ${CROSS_CHANNEL_WINDOW_MS / 1000} seconds`, db, history);
          return;
        }
      }
    },
  },
};

export default spamDetectModule;
