import { db, adjustBalance, getOrCreateEconomy } from '../utils/db.js';
import { withLock, withLocks } from '../framework/mutex.js';
import { BUSINESSES, networthSql } from './catalog.js';
import { bankCapMultiplier } from './effects.js';

/**
 * Money primitives for the whole economy. Rules:
 *  - every balance change is ONE guarded SQL statement (no read-then-write),
 *  - games take the stake up-front (stake) and pay out at the end (payout),
 *  - multi-row moves (transfers) are a single UPDATE touching both rows.
 */

export const TRANSFER_TAX = 0.25;
export const BANK_START_CAP = 5_000;
/** Cost of one unit of bank space. Selling refunds 10% of it. */
export const BANK_SPACE_PRICE = 1;
export const BANK_SELL_REFUND = 0.1;

export type EcoRow = {
  user_id: string;
  balance: number;
  total_earned: number;
  bank: number;
  bank_cap: number;
  notify_rob: number;
  total_lost: number;
};

export async function getEco(guildId: string, userId: string): Promise<EcoRow> {
  await getOrCreateEconomy(guildId, userId);
  const [row] = await db`SELECT * FROM economy WHERE user_id = ${userId}`;
  return row as EcoRow;
}

export async function getCash(guildId: string, userId: string): Promise<number> {
  return (await getEco(guildId, userId)).balance;
}

// ─── Stakes ──────────────────────────────────────────────────────────────────

/**
 * Take a bet out of the wallet before the game starts. Fails (success:false) when the
 * user can't cover it — including when their money is already committed to another game.
 */
export async function stake(guildId: string, userId: string, amount: number, game: string) {
  if (!Number.isSafeInteger(amount) || amount <= 0) return { success: false, newBalance: (await getCash(guildId, userId)) };
  return adjustBalance(guildId, userId, -amount, `bet:${game}`);
}

/** Pay back `amount` (stake + winnings) at the end of a round. No-op for 0. */
export async function payout(guildId: string, userId: string, amount: number, game: string, kind: 'win' | 'push' | 'refund' = 'win') {
  if (amount <= 0) return getCash(guildId, userId);
  const r = await adjustBalance(guildId, userId, Math.floor(amount), `${kind}:${game}`);
  return r.newBalance;
}

/** Record lifetime losses (feeds `/eco games stats`). */
export async function noteLoss(userId: string, amount: number): Promise<void> {
  if (amount > 0) await db`UPDATE economy SET total_lost = total_lost + ${amount} WHERE user_id = ${userId}`;
}

// ─── Atomic cooldown claim ───────────────────────────────────────────────────

/**
 * Claim a cooldown slot in one statement. Two simultaneous `/daily`s can no longer both
 * pass the check (the old get → pay → set sequence let them).
 */
export async function claimCooldown(userId: string, type: string, cooldownMs: number): Promise<{ ok: true } | { ok: false; remainingMs: number }> {
  const now = Date.now();
  const rows = await db`
    INSERT INTO economy_cooldowns (user_id, type, last_used) VALUES (${userId}, ${type}, ${now})
    ON CONFLICT(user_id, type) DO UPDATE SET last_used = excluded.last_used
    WHERE ${now} - economy_cooldowns.last_used >= ${cooldownMs}
    RETURNING last_used
  `;
  if (rows.length > 0) return { ok: true };
  const [row] = await db`SELECT last_used FROM economy_cooldowns WHERE user_id = ${userId} AND type = ${type}`;
  const last = (row?.last_used as number) ?? 0;
  return { ok: false, remainingMs: Math.max(0, cooldownMs - (now - last)) };
}

/** Give a claimed cooldown back (e.g. the action turned out to be invalid after we reserved it). */
export async function releaseCooldown(userId: string, type: string): Promise<void> {
  await db`DELETE FROM economy_cooldowns WHERE user_id = ${userId} AND type = ${type}`;
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (!d && !h && (sec || !parts.length)) parts.push(`${sec}s`);
  return parts.join(' ');
}

// ─── Bank ────────────────────────────────────────────────────────────────────

async function bankLedger(userId: string, delta: number, bankAfter: number, reason: string) {
  await db`INSERT INTO eco_bank_ledger (user_id, delta, bank_after, reason, ts) VALUES (${userId}, ${delta}, ${bankAfter}, ${reason}, ${Date.now()})`;
}

export type BankResult = { ok: true; cash: number; bank: number; bankCap: number } | { ok: false; reason: 'funds' | 'space' | 'invalid'; cash: number; bank: number; bankCap: number };

export async function bankDeposit(guildId: string, userId: string, amount: number): Promise<BankResult> {
  const eco = await getEco(guildId, userId);
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, reason: 'invalid', cash: eco.balance, bank: eco.bank, bankCap: eco.bank_cap };
  const mult = await bankCapMultiplier(userId);
  const rows = await db`
    UPDATE economy SET balance = balance - ${amount}, bank = bank + ${amount}
    WHERE user_id = ${userId} AND balance >= ${amount} AND bank + ${amount} <= CAST(bank_cap * ${mult} AS INTEGER)
    RETURNING balance, bank, bank_cap`;
  if (!rows.length) {
    const cur = await getEco(guildId, userId);
    return { ok: false, reason: cur.balance < amount ? 'funds' : 'space', cash: cur.balance, bank: cur.bank, bankCap: Math.floor(cur.bank_cap * mult) };
  }
  const r = rows[0];
  await db`INSERT INTO eco_ledger (user_id, delta, balance_after, reason, ref, ts) VALUES (${userId}, ${-amount}, ${r.balance}, 'bank:deposit', NULL, ${Date.now()})`;
  await bankLedger(userId, amount, r.bank, 'deposit');
  return { ok: true, cash: r.balance, bank: r.bank, bankCap: Math.floor(r.bank_cap * mult) };
}

export async function bankWithdraw(guildId: string, userId: string, amount: number): Promise<BankResult> {
  const eco = await getEco(guildId, userId);
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, reason: 'invalid', cash: eco.balance, bank: eco.bank, bankCap: eco.bank_cap };
  const rows = await db`
    UPDATE economy SET balance = balance + ${amount}, bank = bank - ${amount}
    WHERE user_id = ${userId} AND bank >= ${amount}
    RETURNING balance, bank, bank_cap`;
  if (!rows.length) {
    const cur = await getEco(guildId, userId);
    return { ok: false, reason: 'funds', cash: cur.balance, bank: cur.bank, bankCap: cur.bank_cap };
  }
  const r = rows[0];
  await db`INSERT INTO eco_ledger (user_id, delta, balance_after, reason, ref, ts) VALUES (${userId}, ${amount}, ${r.balance}, 'bank:withdraw', NULL, ${Date.now()})`;
  await bankLedger(userId, -amount, r.bank, 'withdraw');
  return { ok: true, cash: r.balance, bank: r.bank, bankCap: r.bank_cap };
}

/** Buy `spaces` more bank capacity at BANK_SPACE_PRICE each. */
export async function bankUpgrade(guildId: string, userId: string, spaces: number): Promise<BankResult & { cost: number }> {
  const eco = await getEco(guildId, userId);
  const cost = spaces * BANK_SPACE_PRICE;
  if (!Number.isSafeInteger(spaces) || spaces <= 0) return { ok: false, reason: 'invalid', cash: eco.balance, bank: eco.bank, bankCap: eco.bank_cap, cost };
  const rows = await db`
    UPDATE economy SET balance = balance - ${cost}, bank_cap = bank_cap + ${spaces}
    WHERE user_id = ${userId} AND balance >= ${cost}
    RETURNING balance, bank, bank_cap`;
  if (!rows.length) return { ok: false, reason: 'funds', cash: eco.balance, bank: eco.bank, bankCap: eco.bank_cap, cost };
  const r = rows[0];
  await db`INSERT INTO eco_ledger (user_id, delta, balance_after, reason, ref, ts) VALUES (${userId}, ${-cost}, ${r.balance}, 'bank:upgrade', NULL, ${Date.now()})`;
  return { ok: true, cash: r.balance, bank: r.bank, bankCap: r.bank_cap, cost };
}

/** Sell `spaces` of bank capacity back for 10% of their price. Can't drop below what's stored or the starting cap. */
export async function bankSell(guildId: string, userId: string, spaces: number): Promise<BankResult & { refund: number }> {
  const eco = await getEco(guildId, userId);
  const refund = Math.floor(spaces * BANK_SPACE_PRICE * BANK_SELL_REFUND);
  if (!Number.isSafeInteger(spaces) || spaces <= 0) return { ok: false, reason: 'invalid', cash: eco.balance, bank: eco.bank, bankCap: eco.bank_cap, refund };
  const rows = await db`
    UPDATE economy SET balance = balance + ${refund}, bank_cap = bank_cap - ${spaces}
    WHERE user_id = ${userId} AND bank_cap - ${spaces} >= ${BANK_START_CAP} AND bank_cap - ${spaces} >= bank
    RETURNING balance, bank, bank_cap`;
  if (!rows.length) return { ok: false, reason: 'space', cash: eco.balance, bank: eco.bank, bankCap: eco.bank_cap, refund };
  const r = rows[0];
  if (refund > 0) await db`INSERT INTO eco_ledger (user_id, delta, balance_after, reason, ref, ts) VALUES (${userId}, ${refund}, ${r.balance}, 'bank:sell-space', NULL, ${Date.now()})`;
  return { ok: true, cash: r.balance, bank: r.bank, bankCap: r.bank_cap, refund };
}

// ─── Transfers ───────────────────────────────────────────────────────────────

export type TransferResult =
  | { ok: true; sent: number; tax: number; received: number }
  | { ok: false; reason: 'funds' | 'invalid' | 'self' };

/**
 * Move `amount` out of the sender's BANK into the recipient's CASH, minus TRANSFER_TAX
 * (the tax leaves the economy — it exists to make alt-account farming unprofitable).
 * One UPDATE touches both rows, so it either fully happens or not at all.
 */
export async function transferFromBank(guildId: string, fromId: string, toId: string, amount: number): Promise<TransferResult> {
  if (fromId === toId) return { ok: false, reason: 'self' };
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, reason: 'invalid' };
  const tax = Math.floor(amount * TRANSFER_TAX);
  const received = amount - tax;
  return withLocks([fromId, toId], async () => {
    await getOrCreateEconomy(guildId, fromId);
    await getOrCreateEconomy(guildId, toId);
    const rows = await db`
      UPDATE economy SET
        bank = bank - CASE WHEN user_id = ${fromId} THEN ${amount} ELSE 0 END,
        balance = balance + CASE WHEN user_id = ${toId} THEN ${received} ELSE 0 END,
        total_earned = total_earned + CASE WHEN user_id = ${toId} THEN ${received} ELSE 0 END
      WHERE user_id IN (${fromId}, ${toId})
        AND (SELECT bank FROM economy WHERE user_id = ${fromId}) >= ${amount}
      RETURNING user_id, balance, bank`;
    if (rows.length !== 2) return { ok: false, reason: 'funds' } as const;
    const from = rows.find((r: { user_id: string }) => r.user_id === fromId)!;
    const to = rows.find((r: { user_id: string }) => r.user_id === toId)!;
    await bankLedger(fromId, -amount, from.bank, `transfer:to:${toId}`);
    await db`INSERT INTO eco_ledger (user_id, delta, balance_after, reason, ref, ts) VALUES (${toId}, ${received}, ${to.balance}, 'transfer:in', ${fromId}, ${Date.now()})`;
    return { ok: true, sent: amount, tax, received } as const;
  });
}

/** Move cash between two users atomically with no tax (rob, company bonuses, card sales). */
export async function moveCash(guildId: string, fromId: string, toId: string, amount: number, reason: string): Promise<boolean> {
  if (fromId === toId || !Number.isSafeInteger(amount) || amount <= 0) return false;
  return withLocks([fromId, toId], async () => {
    await getOrCreateEconomy(guildId, fromId);
    await getOrCreateEconomy(guildId, toId);
    const rows = await db`
      UPDATE economy SET
        balance = balance + CASE WHEN user_id = ${fromId} THEN ${-amount} ELSE ${amount} END,
        total_earned = total_earned + CASE WHEN user_id = ${toId} THEN ${amount} ELSE 0 END
      WHERE user_id IN (${fromId}, ${toId})
        AND (SELECT balance FROM economy WHERE user_id = ${fromId}) >= ${amount}
      RETURNING user_id, balance`;
    if (rows.length !== 2) return false;
    const ts = Date.now();
    for (const r of rows as { user_id: string; balance: number }[]) {
      const delta = r.user_id === fromId ? -amount : amount;
      await db`INSERT INTO eco_ledger (user_id, delta, balance_after, reason, ref, ts) VALUES (${r.user_id}, ${delta}, ${r.balance}, ${reason}, ${r.user_id === fromId ? toId : fromId}, ${ts})`;
    }
    return true;
  });
}

// ─── Net worth ───────────────────────────────────────────────────────────────

export interface Wallet {
  cash: number;
  bank: number;
  bankCap: number;
  business: { kind: string; cost: number } | null;
  labSpent: number;
  networth: number;
}

export async function getWallet(guildId: string, userId: string): Promise<Wallet> {
  const eco = await getEco(guildId, userId);
  const [biz] = await db`SELECT kind FROM eco_business WHERE user_id = ${userId}`;
  const [lab] = await db`SELECT total_spent FROM eco_lab WHERE user_id = ${userId}`;
  const business = biz ? { kind: biz.kind as string, cost: BUSINESSES[biz.kind as string]?.cost ?? 0 } : null;
  const labSpent = (lab?.total_spent as number) ?? 0;
  return {
    cash: eco.balance,
    bank: eco.bank,
    bankCap: Math.floor(eco.bank_cap * (await bankCapMultiplier(userId))),
    business,
    labSpent,
    networth: eco.balance + eco.bank + (business?.cost ?? 0) + labSpent,
  };
}

// ─── History & graph ─────────────────────────────────────────────────────────

export interface HistoryEntry { ts: number; delta: number; where: 'cash' | 'bank'; reason: string; after: number }

export async function getHistory(userId: string, limit = 15): Promise<HistoryEntry[]> {
  const cash = await db`SELECT ts, delta, reason, balance_after AS after FROM eco_ledger WHERE user_id = ${userId} ORDER BY id DESC LIMIT ${limit}`;
  const bank = await db`SELECT ts, delta, reason, bank_after AS after FROM eco_bank_ledger WHERE user_id = ${userId} ORDER BY id DESC LIMIT ${limit}`;
  const all: HistoryEntry[] = [
    ...(cash as { ts: number; delta: number; reason: string; after: number }[]).map(r => ({ ...r, where: 'cash' as const })),
    ...(bank as { ts: number; delta: number; reason: string; after: number }[]).map(r => ({ ...r, where: 'bank' as const })),
  ];
  // A deposit/withdraw appears in both ledgers; show only the bank-side row for those.
  const filtered = all.filter(e => !(e.where === 'cash' && e.reason.startsWith('bank:')));
  return filtered.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

/**
 * Total (cash + bank) at the end of each of the last `days` days, reconstructed by walking
 * the ledgers backwards from today's balance. Internal moves (deposit/withdraw) cancel out.
 */
export async function getWealthSeries(guildId: string, userId: string, days = 7): Promise<{ day: string; total: number }[]> {
  const eco = await getEco(guildId, userId);
  const nowTotal = eco.balance + eco.bank;
  const since = Date.now() - days * 86_400_000;
  const cash = await db`SELECT ts, delta FROM eco_ledger WHERE user_id = ${userId} AND ts >= ${since} AND reason NOT LIKE 'bank:%'`;
  const bank = await db`SELECT ts, delta FROM eco_bank_ledger WHERE user_id = ${userId} AND ts >= ${since} AND reason NOT IN ('deposit', 'withdraw')`;
  const events = [...(cash as { ts: number; delta: number }[]), ...(bank as { ts: number; delta: number }[])];

  const out: { day: string; total: number }[] = [];
  for (let i = 0; i < days; i++) {
    const dayEnd = new Date();
    dayEnd.setHours(23, 59, 59, 999);
    dayEnd.setDate(dayEnd.getDate() - (days - 1 - i));
    const endTs = Math.min(dayEnd.getTime(), Date.now());
    const after = events.filter(e => e.ts > endTs).reduce((s, e) => s + e.delta, 0);
    out.push({ day: dayEnd.toISOString().slice(5, 10), total: nowTotal - after });
  }
  return out;
}

// ─── Leaderboards ────────────────────────────────────────────────────────────

export type LbRow = { user_id: string; value: number };

export async function leaderboard(kind: 'cash' | 'networth', userIds: string[] | null, limit = 10): Promise<LbRow[]> {
  const expr = kind === 'cash' ? 'e.balance' : networthSql();
  if (userIds) {
    if (!userIds.length) return [];
    return (await db.unsafe(
      `SELECT e.user_id AS user_id, ${expr} AS value FROM economy e
       INNER JOIN json_each(?) j ON e.user_id = j.value
       ORDER BY value DESC LIMIT ?`, [JSON.stringify(userIds), limit])) as LbRow[];
  }
  return (await db.unsafe(`SELECT e.user_id AS user_id, ${expr} AS value FROM economy e ORDER BY value DESC LIMIT ?`, [limit])) as LbRow[];
}

// ─── One-off claims ──────────────────────────────────────────────────────────

/** Returns true the first time it's called for (user, kind). */
export async function claimOnce(userId: string, kind: string): Promise<boolean> {
  const rows = await db`INSERT INTO eco_bonus_claim (user_id, kind, at) VALUES (${userId}, ${kind}, ${Date.now()}) ON CONFLICT DO NOTHING RETURNING at`;
  return rows.length > 0;
}

export { withLock, withLocks };
