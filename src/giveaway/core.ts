import { db, adjustBalance } from '../utils/db.js';
import { withLock } from '../framework/mutex.js';

/**
 * Giveaways. All state lives in SQLite so an ending time survives restarts; the scheduler ends anything overdue.
 * Money-funded giveaways (`/eco giveaway`) hold the pot in escrow (taken from the host up front) and pay winners at the end.
 *
 * Every state change is one guarded statement (`… WHERE status = 'active' RETURNING`), so two things racing to end,
 * cancel or edit the same giveaway (a timer and a button, two moderators…) can never both succeed.
 */

export const GIVEAWAY_TAX = 0.25;
export const MIN_DURATION = 30_000;
export const MAX_DURATION = 30 * 86_400_000;
export const MAX_WINNERS = 20;
export const MAX_ACTIVE_PER_GUILD = 25;

export interface Giveaway {
  id: number; guild_id: string; channel_id: string; message_id: string | null; host_id: string; prize: string; winners: number; ends_at: number;
  status: 'active' | 'ended' | 'cancelled'; image_url: string | null; pot: number; winner_ids: string; drawn: string; created_at: number;
}
export const winnerList = (g: Pick<Giveaway, 'winner_ids'>): string[] => { try { return JSON.parse(g.winner_ids) as string[]; } catch { return []; } };

export interface NewGiveaway { guildId: string; channelId: string; hostId: string; prize: string; winners: number; durationMs: number; imageUrl?: string | null; pot?: number; now?: number }

export type CreateResult = { ok: true; giveaway: Giveaway } | { ok: false; reason: 'duration' | 'winners' | 'prize' | 'too-many' | 'funds' };

export async function createGiveaway(o: NewGiveaway): Promise<CreateResult> {
  const now = o.now ?? Date.now();
  const prize = o.prize.trim();
  if (!prize || prize.length > 200) return { ok: false, reason: 'prize' };
  if (!Number.isInteger(o.winners) || o.winners < 1 || o.winners > MAX_WINNERS) return { ok: false, reason: 'winners' };
  if (!Number.isFinite(o.durationMs) || o.durationMs < MIN_DURATION || o.durationMs > MAX_DURATION) return { ok: false, reason: 'duration' };
  const active = ((await db`SELECT COUNT(*) AS n FROM giveaways WHERE guild_id = ${o.guildId} AND status = 'active'`) as { n: number }[])[0]!.n;
  if (active >= MAX_ACTIVE_PER_GUILD) return { ok: false, reason: 'too-many' };
  const pot = Math.max(0, Math.floor(o.pot ?? 0));
  if (pot > 0) {
    // Escrow: the host pays now, atomically (fails cleanly if they can't afford it).
    const paid = await adjustBalance(o.guildId, o.hostId, -pot, 'giveaway:escrow');
    if (!paid.success) return { ok: false, reason: 'funds' };
  }
  const rows = (await db`INSERT INTO giveaways (guild_id, channel_id, host_id, prize, winners, ends_at, image_url, pot, created_at)
    VALUES (${o.guildId}, ${o.channelId}, ${o.hostId}, ${prize}, ${o.winners}, ${now + o.durationMs}, ${o.imageUrl ?? null}, ${pot}, ${now}) RETURNING *`) as Giveaway[];
  return { ok: true, giveaway: rows[0]! };
}

export async function attachMessage(id: number, messageId: string): Promise<void> { await db`UPDATE giveaways SET message_id = ${messageId} WHERE id = ${id}`; }
export async function getGiveaway(id: number): Promise<Giveaway | undefined> { return ((await db`SELECT * FROM giveaways WHERE id = ${id}`) as Giveaway[])[0]; }
export async function getByMessage(messageId: string): Promise<Giveaway | undefined> { return ((await db`SELECT * FROM giveaways WHERE message_id = ${messageId}`) as Giveaway[])[0]; }
export async function entryCount(id: number): Promise<number> { return ((await db`SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway_id = ${id}`) as { n: number }[])[0]!.n; }
export async function entrants(id: number): Promise<string[]> { return ((await db`SELECT user_id FROM giveaway_entries WHERE giveaway_id = ${id} ORDER BY entered_at`) as { user_id: string }[]).map(r => r.user_id); }
export async function listActive(guildId: string, hostId?: string): Promise<Giveaway[]> {
  return (hostId
    ? await db`SELECT * FROM giveaways WHERE guild_id = ${guildId} AND status = 'active' AND host_id = ${hostId} ORDER BY ends_at LIMIT 25`
    : await db`SELECT * FROM giveaways WHERE guild_id = ${guildId} AND status = 'active' ORDER BY ends_at LIMIT 25`) as Giveaway[];
}
export async function dueGiveaways(now = Date.now()): Promise<Giveaway[]> {
  return (await db`SELECT * FROM giveaways WHERE status = 'active' AND ends_at <= ${now} ORDER BY ends_at LIMIT 50`) as Giveaway[];
}

export type EnterResult = 'entered' | 'left' | 'ended' | 'missing';

/** Clicking Enter joins; clicking again leaves. Only while the giveaway is active. */
export async function toggleEntry(id: number, userId: string, now = Date.now()): Promise<EnterResult> {
  const g = await getGiveaway(id);
  if (!g) return 'missing';
  if (g.status !== 'active' || g.ends_at <= now) return 'ended';
  const inserted = (await db`INSERT OR IGNORE INTO giveaway_entries (giveaway_id, user_id, entered_at) VALUES (${id}, ${userId}, ${now}) RETURNING user_id`) as unknown[];
  if (inserted.length) return 'entered';
  await db`DELETE FROM giveaway_entries WHERE giveaway_id = ${id} AND user_id = ${userId}`;
  return 'left';
}

/** `n` distinct winners, uniformly at random (cryptographic randomness), from `pool`. */
export function pickWinners(pool: string[], n: number, rand: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0]! / 0x1_0000_0000): string[] {
  const a = [...new Set(pool)];
  const k = Math.min(n, a.length);
  for (let i = 0; i < k; i++) { const j = i + Math.floor(rand() * (a.length - i)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a.slice(0, k);
}

export const payoutPerWinner = (pot: number, winners: number): number => (winners > 0 ? Math.floor((pot * (1 - GIVEAWAY_TAX)) / winners) : 0);

export interface Ended { giveaway: Giveaway; winners: string[]; entries: number; paid: number }

/** Ends a giveaway exactly once. Returns undefined if something else already ended/cancelled it. */
export function endGiveaway(id: number, o: { now?: number; rand?: () => number } = {}): Promise<Ended | undefined> {
  return withLock(`giveaway:${id}`, async () => {
    const claimed = (await db`UPDATE giveaways SET status = 'ended' WHERE id = ${id} AND status = 'active' RETURNING *`) as Giveaway[];
    if (!claimed.length) return undefined;
    const g = claimed[0]!;
    const pool = await entrants(id);
    const winners = pickWinners(pool, g.winners, o.rand);
    await db`UPDATE giveaways SET winner_ids = ${JSON.stringify(winners)}, drawn = ${JSON.stringify(winners)} WHERE id = ${id}`;
    let paid = 0;
    if (g.pot > 0) {
      if (!winners.length) await adjustBalance(g.guild_id, g.host_id, g.pot, 'giveaway:refund'); // nobody entered: the host gets everything back
      else {
        const share = payoutPerWinner(g.pot, winners.length);
        for (const w of winners) { await adjustBalance(g.guild_id, w, share, 'giveaway:win'); paid += share; }
      }
    }
    return { giveaway: { ...g, winner_ids: JSON.stringify(winners) }, winners, entries: pool.length, paid };
  });
}

/** New winners for an ended giveaway (not for money-funded ones — those were already paid). */
export async function rerollGiveaway(id: number, count?: number, rand?: () => number): Promise<{ ok: true; winners: string[] } | { ok: false; reason: 'missing' | 'active' | 'funded' | 'no-entries' }> {
  const g = await getGiveaway(id);
  if (!g) return { ok: false, reason: 'missing' };
  if (g.status !== 'ended') return { ok: false, reason: 'active' };
  if (g.pot > 0) return { ok: false, reason: 'funded' };
  // Nobody wins twice in one giveaway until everyone has: exclude everyone drawn so far, and start over only once the pool is exhausted.
  const drawn: string[] = (() => { try { return JSON.parse(g.drawn) as string[]; } catch { return []; } })();
  const pool = await entrants(id);
  const fresh = pool.filter(u => !drawn.includes(u));
  const n = Math.min(Math.max(1, count ?? g.winners), MAX_WINNERS);
  const winners = pickWinners(fresh.length ? fresh : pool, n, rand);
  if (!winners.length) return { ok: false, reason: 'no-entries' };
  const nextDrawn = fresh.length ? [...drawn, ...winners] : winners;
  await db`UPDATE giveaways SET winner_ids = ${JSON.stringify(winners)}, drawn = ${JSON.stringify(nextDrawn)} WHERE id = ${id}`;
  return { ok: true, winners };
}

/** Cancels an active giveaway without picking winners; funded ones refund the host in full. */
export function cancelGiveaway(id: number): Promise<Giveaway | undefined> {
  return withLock(`giveaway:${id}`, async () => {
    const claimed = (await db`UPDATE giveaways SET status = 'cancelled' WHERE id = ${id} AND status = 'active' RETURNING *`) as Giveaway[];
    const g = claimed[0];
    if (g && g.pot > 0) await adjustBalance(g.guild_id, g.host_id, g.pot, 'giveaway:refund');
    return g;
  });
}

export async function editGiveaway(id: number, patch: { prize?: string; winners?: number; endsAt?: number }): Promise<Giveaway | undefined> {
  const g = await getGiveaway(id);
  if (!g || g.status !== 'active') return undefined;
  const prize = patch.prize?.trim() || g.prize, winners = patch.winners ?? g.winners, endsAt = patch.endsAt ?? g.ends_at;
  const rows = (await db`UPDATE giveaways SET prize = ${prize.slice(0, 200)}, winners = ${Math.min(MAX_WINNERS, Math.max(1, winners))}, ends_at = ${endsAt} WHERE id = ${id} AND status = 'active' RETURNING *`) as Giveaway[];
  return rows[0];
}
