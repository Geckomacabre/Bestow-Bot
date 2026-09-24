import { Client, Colors, EmbedBuilder, TextChannel } from 'discord.js';
import { EventModule } from '../feature';
import logger from '../../utils/logger';

/**
 * Sticky messages — keeps a message pinned to the bottom of a channel by
 * deleting and re-posting it whenever someone else talks.
 *
 * Reposting is debounced per channel rather than done on every message: a busy
 * channel would otherwise mean one delete+post per message, which burns rate
 * limit and makes the sticky flicker. Waiting a beat also means a burst of
 * chatter only costs one repost.
 */
const REPOST_DELAY_MS = 3_000;
/**
 * Upper bound on how long a repost can be deferred. Without this the debounce
 * below is unbounded: every new message resets the timer, so a channel busier
 * than one message per REPOST_DELAY_MS would reset it forever and the sticky
 * would never repost — failing precisely in the busy channels that need it.
 */
const MAX_REPOST_WAIT_MS = 10_000;

// channel_id -> pending repost timer
const pending = new Map<string, ReturnType<typeof setTimeout>>();
// channel_id -> when the current deferral started, so it can be capped.
const deferredSince = new Map<string, number>();
// channel_id -> true while a repost is in flight, so overlapping triggers don't
// double-post (which would leave an orphaned sticky above the new one).
const inFlight = new Set<string>();
// Triggers that arrived mid-repost. They can't run concurrently, but they must
// not be dropped either: messages sent during a repost would leave the sticky
// stranded above them with nothing scheduled to fix it.
const rerunNeeded = new Set<string>();
// Message ids of stickies WE posted, so our own sticky doesn't re-trigger.
const ownStickyIds = new Set<string>();
// Channels we're mid-post in. The gateway's MESSAGE_CREATE for our own sticky
// can arrive BEFORE channel.send() resolves, i.e. before its id is known — so
// an id-only guard misses it, the sticky triggers itself and reposts forever.
// This covers that window: while set, our own messages in the channel are
// ignored.
const posting = new Set<string>();

/**
 * Minimum gap between reposts in a channel. Without it, a steady stream of
 * messages reposts the sticky every few seconds, which reads as the bot
 * constantly deleting and re-sending.
 */
const MIN_REPOST_INTERVAL_MS = 30_000;
// channel_id -> when we last reposted
const lastRepostAt = new Map<string, number>();

function buildPayload(content: string, asEmbed: boolean, gold = false) {
  if (!asEmbed) return { content };
  return {
    embeds: [new EmbedBuilder().setColor(gold ? Colors.Gold : Colors.Blurple).setDescription(content)],
  };
}

/**
 * Resolves what a sticky should say right now. 'jackpot' stickies are rebuilt
 * from the live pot on every repost — a static snapshot would be out of date
 * the moment the next bet landed.
 */
async function resolveContent(sticky: { kind: string; guild_id: string; content: string }): Promise<string> {
  if (sticky.kind === 'jackpot') {
    const { formatJackpotMessage } = await import('../../utils/gamble.js');
    return formatJackpotMessage(sticky.guild_id);
  }
  return sticky.content;
}

async function repost(channel: TextChannel, db: typeof import('../../utils/db')) {
  const id = channel.id;
  // Don't run two reposts at once, but remember that another was wanted.
  if (inFlight.has(id)) { rerunNeeded.add(id); return; }
  inFlight.add(id);
  try {
    const sticky = await db.getSticky(id);
    if (!sticky) return;

    // Delete the previous copy first so only one sticky exists at a time.
    if (sticky.message_id) {
      ownStickyIds.delete(sticky.message_id);
      await channel.messages.delete(sticky.message_id).catch(() => {
        // Already gone (deleted manually, purged, etc.) — nothing to clean up.
      });
    }

    const content = await resolveContent(sticky);
    // Guard the whole send window — see `posting` above.
    posting.add(id);
    let sent;
    try {
      sent = await channel.send(buildPayload(content, sticky.embed === 1, sticky.kind === 'jackpot'));
      ownStickyIds.add(sent.id);
    } finally {
      posting.delete(id);
    }
    lastRepostAt.set(id, Date.now());
    await db.setStickyMessageId(id, sent.id);
  } catch (err: any) {
    logger.warn(`[sticky] repost failed in ${channel.id}: ${err?.message ?? err}`);
  } finally {
    inFlight.delete(id);
    // Someone talked while we were posting — go again so the sticky ends up
    // below their messages rather than stranded above them.
    if (rerunNeeded.delete(id)) scheduleRepost(channel, db);
  }
}

function scheduleRepost(channel: TextChannel, db: typeof import('../../utils/db')) {
  const id = channel.id;
  const now = Date.now();
  if (!deferredSince.has(id)) deferredSince.set(id, now);

  const existing = pending.get(id);
  if (existing) clearTimeout(existing);

  // Normally wait for a lull, but never defer past MAX_REPOST_WAIT_MS from the
  // first trigger — otherwise continuous chatter starves the repost entirely.
  const waited = now - (deferredSince.get(id) ?? now);
  let delay = Math.max(0, Math.min(REPOST_DELAY_MS, MAX_REPOST_WAIT_MS - waited));

  // ...but never repost more often than MIN_REPOST_INTERVAL_MS. Busy channels
  // would otherwise re-send every few seconds, which just looks like the bot
  // spamming. The sticky sits a little higher for a bit; that's the trade.
  const sinceLast = now - (lastRepostAt.get(id) ?? 0);
  if (sinceLast < MIN_REPOST_INTERVAL_MS) {
    delay = Math.max(delay, MIN_REPOST_INTERVAL_MS - sinceLast);
  }

  pending.set(id, setTimeout(() => {
    pending.delete(id);
    deferredSince.delete(id);
    void repost(channel, db);
  }, delay));
}

const stickyModule: EventModule = {
  name: 'sticky',
  handlers: {
    messageCreate: async ({ data: [message], db }) => {
      if (!message.guild) return;
      const channel = message.channel;
      if (!channel.isTextBased() || channel.isDMBased()) return;

      // Only ignore the sticky itself (which would otherwise re-trigger and
      // repost forever). Other bot messages MUST count: in channels like
      // #claim or #plinko nearly all the content is this bot's own replies to
      // slash commands, so skipping every bot message meant the sticky never
      // moved and just sat above them.
      if (ownStickyIds.has(message.id)) return;
      // Our own message that arrived while we were posting — this is the
      // sticky itself, racing its own send() response. Record it so the id
      // guard catches any later duplicate event.
      if (message.author.id === message.client.user?.id && posting.has(channel.id)) {
        ownStickyIds.add(message.id);
        return;
      }

      const sticky = await db.getSticky(channel.id);
      if (!sticky) return;
      if (sticky.message_id && message.id === sticky.message_id) return;

      scheduleRepost(channel as TextChannel, db);
    },

    // Slash-command replies are what fills channels like #claim and #plinko.
    // Depending on how a reply is sent (interaction callback vs. follow-up),
    // messageCreate isn't guaranteed to fire for it, so trigger off the
    // interaction itself too. The debounce collapses the duplicate when both
    // fire, and gives the reply time to land before we repost beneath it.
    interactionCreate: async ({ data: [interaction], db }) => {
      if (!interaction.isChatInputCommand() || !interaction.guildId) return;
      const channel = interaction.channel;
      if (!channel?.isTextBased?.() || channel.isDMBased?.()) return;

      const sticky = await db.getSticky(channel.id);
      if (!sticky) return;

      scheduleRepost(channel as TextChannel, db);
    },
  },
};

/** Posts (or re-posts) the sticky immediately — used right after /sticky set. */
export async function postStickyNow(channel: TextChannel, db: typeof import('../../utils/db')) {
  const timer = pending.get(channel.id);
  if (timer) { clearTimeout(timer); pending.delete(channel.id); }
  deferredSince.delete(channel.id);
  await repost(channel, db);
}

/** Clears any pending repost when a sticky is removed. */
export function cancelSticky(channelId: string) {
  const timer = pending.get(channelId);
  if (timer) { clearTimeout(timer); pending.delete(channelId); }
  deferredSince.delete(channelId);
  lastRepostAt.delete(channelId);
  rerunNeeded.delete(channelId);
}

// ── Periodic refresh for live stickies ────────────────────────────────────────

const REFRESH_MS = 10 * 60_000;

/**
 * Refreshes live ('jackpot') stickies on a timer so the amount doesn't sit
 * stale in a channel nobody is talking in.
 *
 * This EDITS the existing message rather than reposting it. A repost would bump
 * the channel and mark it unread every 30 minutes for no reason — and in a
 * quiet channel the sticky is already the newest message, so there's nothing to
 * move it below. Chat activity still triggers a proper repost.
 */
async function refreshLiveStickies(client: Client) {
  const db = await import('../../utils/db.js');
  let rows: Awaited<ReturnType<typeof db.getStickiesByKind>>;
  try {
    rows = await db.getStickiesByKind('jackpot');
  } catch (err: any) {
    logger.warn(`[sticky] refresh lookup failed: ${err?.message ?? err}`);
    return;
  }

  for (const sticky of rows) {
    // A repost already in flight will post fresh content anyway.
    if (!sticky.message_id || inFlight.has(sticky.channel_id)) continue;
    try {
      const channel = await client.channels.fetch(sticky.channel_id).catch(() => null);
      if (!channel || !channel.isTextBased() || channel.isDMBased()) continue;
      const msg = await (channel as TextChannel).messages.fetch(sticky.message_id).catch(() => null);
      // Gone (purged/deleted) — leave it; the next message in the channel reposts it.
      if (!msg) continue;
      const content = await resolveContent(sticky);
      await msg.edit(buildPayload(content, sticky.embed === 1, true));
    } catch (err: any) {
      logger.warn(`[sticky] refresh failed in ${sticky.channel_id}: ${err?.message ?? err}`);
    }
  }
}

/** Starts the periodic refresh of live stickies. */
export function startStickyRefresh(client: Client) {
  setInterval(() => { void refreshLiveStickies(client); }, REFRESH_MS);
}

export default stickyModule;
