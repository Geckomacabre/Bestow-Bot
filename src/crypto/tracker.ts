import { ContainerBuilder, MessageFlags, TextDisplayBuilder, type Client } from 'discord.js';
import { db } from '../utils/db.js';
import logger from '../utils/logger.js';
import { CHAIN_COLOR, CHAIN_NAMES, fmtCoin, CHAIN_SYMBOL, txInfo, type Chain } from '../lookups/chain.js';

/**
 * /crypto track: watch a transaction until it has N confirmations, then tell the person (in the channel they asked from when the
 * bot can post there, otherwise by DM). Trackers are stored so they survive restarts, and give up after 48 hours.
 */

export const MAX_PER_USER = 5;
export const TTL_MS = 48 * 3_600_000;
export const POLL_MS = 60_000;

export interface Tracker { id: number; user_id: string; chain: Chain; txid: string; target: number; channel_id: string | null; created_at: number }

export async function initTrackerSchema(): Promise<void> {
  await db`CREATE TABLE IF NOT EXISTS crypto_trackers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT    NOT NULL,
    chain      TEXT    NOT NULL,
    txid       TEXT    NOT NULL,
    target     INTEGER NOT NULL,
    channel_id TEXT,
    created_at INTEGER NOT NULL
  )`;
}

export async function addTracker(t: Omit<Tracker, 'id'>): Promise<Tracker | 'limit' | 'duplicate'> {
  const mine = (await db`SELECT txid FROM crypto_trackers WHERE user_id = ${t.user_id}`) as { txid: string }[];
  if (mine.some(m => m.txid === t.txid)) return 'duplicate';
  if (mine.length >= MAX_PER_USER) return 'limit';
  return ((await db`INSERT INTO crypto_trackers (user_id, chain, txid, target, channel_id, created_at) VALUES (${t.user_id}, ${t.chain}, ${t.txid}, ${t.target}, ${t.channel_id}, ${t.created_at}) RETURNING *`) as Tracker[])[0]!;
}

export async function stopTrackers(userId: string): Promise<number> {
  return ((await db`DELETE FROM crypto_trackers WHERE user_id = ${userId} RETURNING 1`) as unknown[]).length;
}

async function notify(client: Client, t: Tracker, text: string) {
  const payload = { flags: MessageFlags.IsComponentsV2 as const, components: [new ContainerBuilder().setAccentColor(CHAIN_COLOR[t.chain]).addTextDisplayComponents(new TextDisplayBuilder().setContent(text))], allowedMentions: { users: [t.user_id] } };
  if (t.channel_id) {
    const ch = await client.channels.fetch(t.channel_id).catch(() => null);
    if (ch?.isSendable() && (await ch.send(payload).then(() => true).catch(() => false))) return;
  }
  const u = await client.users.fetch(t.user_id).catch(() => null);
  await u?.send(payload).catch(() => {});
}

/** One polling pass: notify and remove trackers that reached their target (or expired). Exposed for tests. */
export async function checkTrackers(client: Client, now = Date.now(), lookup = txInfo): Promise<number> {
  const all = (await db`SELECT * FROM crypto_trackers ORDER BY id`) as Tracker[];
  let done = 0;
  for (const t of all) {
    if (now - t.created_at > TTL_MS) {
      await db`DELETE FROM crypto_trackers WHERE id = ${t.id}`;
      await notify(client, t, `<@${t.user_id}> ⏰ Stopped tracking \`${t.txid.slice(0, 16)}…\` on ${CHAIN_NAMES[t.chain]} — it didn't reach ${t.target} confirmation${t.target === 1 ? '' : 's'} within 48 hours.`);
      done++;
      continue;
    }
    try {
      const tx = await lookup(t.txid, t.chain);
      if (tx.status === 'failed') {
        await db`DELETE FROM crypto_trackers WHERE id = ${t.id}`;
        await notify(client, t, `<@${t.user_id}> ❌ Your ${CHAIN_NAMES[t.chain]} transaction \`${t.txid.slice(0, 16)}…\` failed.\n${tx.explorer}`);
        done++;
      } else if (tx.confirmations >= t.target) {
        await db`DELETE FROM crypto_trackers WHERE id = ${t.id}`;
        await notify(client, t, `<@${t.user_id}> ✅ Your ${CHAIN_NAMES[t.chain]} transaction has **${tx.confirmations}** confirmation${tx.confirmations === 1 ? '' : 's'}.\n**Amount:** ${fmtCoin(tx.amount, CHAIN_SYMBOL[t.chain])}\n${tx.explorer}`);
        done++;
      }
    } catch (e) { logger.debug(`[crypto tracker] ${t.id}: ${(e as Error).message}`); }
  }
  return done;
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startCryptoTrackers(client: Client): void {
  if (timer) return;
  timer = setInterval(() => { checkTrackers(client).catch(err => logger.warn(`[crypto tracker] ${err}`)); }, POLL_MS);
}
