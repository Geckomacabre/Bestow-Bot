import { db } from '../utils/db.js';

/**
 * Small per-person and per-server records behind /me, /donate and /pingonjoin.
 *  - bestow_users: a public Bestow UID (#1, #2… in order of first use), when you first used the bot, and how many commands you've run.
 *  - donations: donations people submit; they count on the leaderboard once a bot owner approves them.
 *  - ping_on_join: channels where new members get pinged (the ping is deleted a few seconds later).
 */

export async function initProfileSchema(): Promise<void> {
  await db`CREATE TABLE IF NOT EXISTS bestow_users (
    uid        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT    NOT NULL UNIQUE,
    first_seen INTEGER NOT NULL,
    commands   INTEGER NOT NULL DEFAULT 0
  )`;
  await db`CREATE TABLE IF NOT EXISTS donations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    amount      REAL    NOT NULL,
    note        TEXT,
    status      TEXT    NOT NULL DEFAULT 'pending',
    created_at  INTEGER NOT NULL,
    reviewed_at INTEGER
  )`;
  await db`CREATE TABLE IF NOT EXISTS ping_on_join (
    guild_id   TEXT    NOT NULL,
    channel_id TEXT    NOT NULL,
    message    TEXT,
    created_by TEXT    NOT NULL,
    PRIMARY KEY (guild_id, channel_id)
  )`;
}

// ─── Bestow users ────────────────────────────────────────────────────────────

export interface BestowUser { uid: number; user_id: string; first_seen: number; commands: number }

/** Counts one command for the person (creating their UID on first use). */
export async function countCommand(userId: string, now = Date.now()): Promise<void> {
  await db`INSERT INTO bestow_users (user_id, first_seen, commands) VALUES (${userId}, ${now}, 1) ON CONFLICT (user_id) DO UPDATE SET commands = commands + 1`;
}

export async function userById(userId: string): Promise<BestowUser | null> {
  return ((await db`SELECT * FROM bestow_users WHERE user_id = ${userId}`) as BestowUser[])[0] ?? null;
}
export async function userByUid(uid: number): Promise<BestowUser | null> {
  return ((await db`SELECT * FROM bestow_users WHERE uid = ${uid}`) as BestowUser[])[0] ?? null;
}
export async function userCount(): Promise<number> {
  return ((await db`SELECT COUNT(*) AS n FROM bestow_users`) as { n: number }[])[0]!.n;
}

// ─── Donations ───────────────────────────────────────────────────────────────

export interface Donation { id: number; user_id: string; name: string; amount: number; note: string | null; status: 'pending' | 'approved' | 'rejected'; created_at: number; reviewed_at: number | null }

export const MAX_AMOUNT = 100_000;

export async function submitDonation(userId: string, name: string, amount: number, note: string | null, now = Date.now()): Promise<Donation> {
  if (!(amount > 0 && amount <= MAX_AMOUNT)) throw new Error('bad amount');
  const r = (await db`INSERT INTO donations (user_id, name, amount, note, created_at) VALUES (${userId}, ${name.slice(0, 64)}, ${Math.round(amount * 100) / 100}, ${note?.slice(0, 200) ?? null}, ${now}) RETURNING *`) as Donation[];
  return r[0]!;
}

/** Approve or reject a pending donation; returns it, or null if it was already reviewed (so two owners can't both act on it). */
export async function reviewDonation(id: number, approve: boolean, now = Date.now()): Promise<Donation | null> {
  const r = (await db`UPDATE donations SET status = ${approve ? 'approved' : 'rejected'}, reviewed_at = ${now} WHERE id = ${id} AND status = 'pending' RETURNING *`) as Donation[];
  return r[0] ?? null;
}

export async function donationLeaderboard(limit = 15): Promise<{ user_id: string; name: string; total: number; count: number }[]> {
  return (await db`SELECT user_id, MAX(name) AS name, SUM(amount) AS total, COUNT(*) AS count FROM donations WHERE status = 'approved' GROUP BY user_id ORDER BY total DESC LIMIT ${limit}`) as { user_id: string; name: string; total: number; count: number }[];
}

export async function donationTotal(userId: string): Promise<number> {
  return ((await db`SELECT COALESCE(SUM(amount), 0) AS t FROM donations WHERE user_id = ${userId} AND status = 'approved'`) as { t: number }[])[0]!.t;
}

// ─── Ping on join ────────────────────────────────────────────────────────────

export interface PingChannel { guild_id: string; channel_id: string; message: string | null; created_by: string }
export const MAX_PING_CHANNELS = 5;

export async function pingChannels(guildId: string): Promise<PingChannel[]> {
  return (await db`SELECT * FROM ping_on_join WHERE guild_id = ${guildId}`) as PingChannel[];
}
export async function addPingChannel(guildId: string, channelId: string, message: string | null, by: string): Promise<'added' | 'updated' | 'full'> {
  const existing = await pingChannels(guildId);
  const had = existing.some(c => c.channel_id === channelId);
  if (!had && existing.length >= MAX_PING_CHANNELS) return 'full';
  await db`INSERT INTO ping_on_join (guild_id, channel_id, message, created_by) VALUES (${guildId}, ${channelId}, ${message}, ${by})
    ON CONFLICT (guild_id, channel_id) DO UPDATE SET message = ${message}, created_by = ${by}`;
  return had ? 'updated' : 'added';
}
export async function removePingChannel(guildId: string, channelId: string): Promise<boolean> {
  return ((await db`DELETE FROM ping_on_join WHERE guild_id = ${guildId} AND channel_id = ${channelId} RETURNING 1`) as unknown[]).length > 0;
}
export async function clearPingChannels(guildId: string): Promise<number> {
  return ((await db`DELETE FROM ping_on_join WHERE guild_id = ${guildId} RETURNING 1`) as unknown[]).length;
}

/** {user} / {server} placeholders in a ping-on-join message. */
export const renderPing = (tpl: string | null, userId: string, server: string) =>
  (tpl?.trim() ? tpl : '{user}').replace(/\{user\}/gi, `<@${userId}>`).replace(/\{server\}/gi, server);
