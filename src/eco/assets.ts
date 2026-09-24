import { db, adjustBalance } from '../utils/db.js';
import { withLock } from '../framework/mutex.js';
import { rand, randInt } from '../utils/random.js';
import {
  BUSINESSES, BUSINESS_SELL_REFUND, INVESTMENTS, LAB, MAX_ACCRUAL_HOURS, QUEST_TIERS, QUEST_TITLES,
} from './catalog.js';
import { careerMultiplier } from './effects.js';
import { getCash } from './core.js';

const HOUR = 3_600_000;
const lockKey = (userId: string) => `eco:${userId}`;

// ─── Businesses ──────────────────────────────────────────────────────────────

export type BusinessRow = { user_id: string; kind: string; bought_at: number; last_collected: number };

export async function getBusiness(userId: string): Promise<BusinessRow | null> {
  const [row] = await db`SELECT * FROM eco_business WHERE user_id = ${userId}`;
  return (row as BusinessRow) ?? null;
}

/** Coins waiting to be collected: hourly rate × hours since last collection, capped at MAX_ACCRUAL_HOURS. */
export function businessPending(kind: string, lastCollected: number, now = Date.now()): number {
  const def = BUSINESSES[kind];
  if (!def) return 0;
  const hours = Math.min(MAX_ACCRUAL_HOURS, Math.max(0, (now - lastCollected) / HOUR));
  return Math.floor(hours * def.perHour);
}

export async function buyBusiness(guildId: string, userId: string, kind: string) {
  const def = BUSINESSES[kind];
  if (!def) return { ok: false as const, reason: 'unknown' as const };
  return withLock(lockKey(userId), async () => {
    if (await getBusiness(userId)) return { ok: false as const, reason: 'owned' as const };
    const paid = await adjustBalance(guildId, userId, -def.cost, `business:buy:${kind}`);
    if (!paid.success) return { ok: false as const, reason: 'funds' as const, cash: paid.newBalance };
    const now = Date.now();
    await db`INSERT INTO eco_business (user_id, kind, bought_at, last_collected) VALUES (${userId}, ${kind}, ${now}, ${now})`;
    return { ok: true as const, def, cash: paid.newBalance };
  });
}

export async function collectBusiness(guildId: string, userId: string) {
  return withLock(lockKey(userId), async () => {
    const biz = await getBusiness(userId);
    if (!biz) return { ok: false as const, reason: 'none' as const };
    const now = Date.now();
    const base = businessPending(biz.kind, biz.last_collected, now);
    if (base < 1) return { ok: false as const, reason: 'empty' as const };
    // Optimistic guard: only the call that moves last_collected forward gets paid.
    const moved = await db`UPDATE eco_business SET last_collected = ${now} WHERE user_id = ${userId} AND last_collected = ${biz.last_collected} RETURNING user_id`;
    if (!moved.length) return { ok: false as const, reason: 'empty' as const };
    const amount = Math.floor(base * (await careerMultiplier(userId)));
    const { newBalance } = await adjustBalance(guildId, userId, amount, `business:collect:${biz.kind}`);
    return { ok: true as const, amount, cash: newBalance, kind: biz.kind };
  });
}

export async function sellBusiness(guildId: string, userId: string) {
  return withLock(lockKey(userId), async () => {
    const biz = await getBusiness(userId);
    if (!biz) return { ok: false as const, reason: 'none' as const };
    const gone = await db`DELETE FROM eco_business WHERE user_id = ${userId} AND kind = ${biz.kind} RETURNING kind`;
    if (!gone.length) return { ok: false as const, reason: 'none' as const };
    // Sell also pays out whatever had accrued.
    const pending = businessPending(biz.kind, biz.last_collected);
    const refund = Math.floor((BUSINESSES[biz.kind]?.cost ?? 0) * BUSINESS_SELL_REFUND) + pending;
    const { newBalance } = await adjustBalance(guildId, userId, refund, `business:sell:${biz.kind}`);
    return { ok: true as const, refund, pending, cash: newBalance, kind: biz.kind };
  });
}

// ─── Laboratory ──────────────────────────────────────────────────────────────

export type LabRow = { user_id: string; level: number; ampoules: number; bought_at: number; last_collected: number; total_spent: number };

export async function getLab(userId: string): Promise<LabRow | null> {
  const [row] = await db`SELECT * FROM eco_lab WHERE user_id = ${userId}`;
  return (row as LabRow) ?? null;
}

export const labRate = (level: number) => LAB.perHourPerLevel * level;
export const labCapacity = (level: number) => LAB.ampoulesPerLevel * level;
export const labUpgradeCost = (level: number) => LAB.upgradeCostPerLevel * level;

/** Hours the lab can currently bill: limited by elapsed time, stored ampoules and the accrual cap. */
export function labProducible(lab: Pick<LabRow, 'ampoules' | 'last_collected'>, now = Date.now()): number {
  const elapsedH = Math.max(0, (now - lab.last_collected) / HOUR);
  return Math.min(elapsedH, lab.ampoules, LAB.maxAccrualHours);
}

export async function buyLab(guildId: string, userId: string) {
  return withLock(lockKey(userId), async () => {
    if (await getLab(userId)) return { ok: false as const, reason: 'owned' as const };
    const paid = await adjustBalance(guildId, userId, -LAB.buyCost, 'lab:buy');
    if (!paid.success) return { ok: false as const, reason: 'funds' as const, cash: paid.newBalance };
    const now = Date.now();
    await db`INSERT INTO eco_lab (user_id, level, ampoules, bought_at, last_collected, total_spent) VALUES (${userId}, 1, 0, ${now}, ${now}, ${LAB.buyCost})`;
    return { ok: true as const, cash: paid.newBalance };
  });
}

export async function buyAmpoules(guildId: string, userId: string, amount: number) {
  return withLock(lockKey(userId), async () => {
    const lab = await getLab(userId);
    if (!lab) return { ok: false as const, reason: 'none' as const };
    const room = labCapacity(lab.level) - lab.ampoules;
    if (amount > room) return { ok: false as const, reason: 'full' as const, room };
    const cost = amount * LAB.ampoulePrice;
    const paid = await adjustBalance(guildId, userId, -cost, 'lab:ampoules');
    if (!paid.success) return { ok: false as const, reason: 'funds' as const, cost, cash: paid.newBalance };
    // If the lab was idle (no fuel), production restarts from now instead of billing dead time.
    const idle = lab.ampoules === 0;
    await db`UPDATE eco_lab SET ampoules = ampoules + ${amount}, last_collected = CASE WHEN ${idle ? 1 : 0} = 1 THEN ${Date.now()} ELSE last_collected END WHERE user_id = ${userId}`;
    return { ok: true as const, cost, cash: paid.newBalance, ampoules: lab.ampoules + amount };
  });
}

export async function collectLab(guildId: string, userId: string) {
  return withLock(lockKey(userId), async () => {
    const lab = await getLab(userId);
    if (!lab) return { ok: false as const, reason: 'none' as const };
    const now = Date.now();
    const hours = labProducible(lab, now);
    const amountBase = Math.floor(hours * labRate(lab.level));
    if (amountBase < 1) return { ok: false as const, reason: lab.ampoules === 0 ? ('no-ampoules' as const) : ('empty' as const) };
    // One ampoule per running hour, rounded to the nearest hour (never 0) — a few extra milliseconds shouldn't burn a whole one.
    const used = Math.min(lab.ampoules, Math.max(1, Math.round(hours)));
    const moved = await db`UPDATE eco_lab SET ampoules = ampoules - ${used}, last_collected = ${now}
      WHERE user_id = ${userId} AND last_collected = ${lab.last_collected} AND ampoules >= ${used} RETURNING user_id`;
    if (!moved.length) return { ok: false as const, reason: 'empty' as const };
    const amount = Math.floor(amountBase * (await careerMultiplier(userId)));
    const { newBalance } = await adjustBalance(guildId, userId, amount, 'lab:collect');
    return { ok: true as const, amount, used, cash: newBalance, ampoulesLeft: lab.ampoules - used };
  });
}

export async function upgradeLab(guildId: string, userId: string) {
  return withLock(lockKey(userId), async () => {
    const lab = await getLab(userId);
    if (!lab) return { ok: false as const, reason: 'none' as const };
    if (lab.level >= LAB.maxLevel) return { ok: false as const, reason: 'max' as const };
    const cost = labUpgradeCost(lab.level);
    const paid = await adjustBalance(guildId, userId, -cost, 'lab:upgrade');
    if (!paid.success) return { ok: false as const, reason: 'funds' as const, cost, cash: paid.newBalance };
    await db`UPDATE eco_lab SET level = level + 1, total_spent = total_spent + ${cost} WHERE user_id = ${userId}`;
    return { ok: true as const, level: lab.level + 1, cost, cash: paid.newBalance };
  });
}

export async function sellLab(guildId: string, userId: string) {
  return withLock(lockKey(userId), async () => {
    const lab = await getLab(userId);
    if (!lab) return { ok: false as const, reason: 'none' as const };
    const gone = await db`DELETE FROM eco_lab WHERE user_id = ${userId} RETURNING total_spent`;
    if (!gone.length) return { ok: false as const, reason: 'none' as const };
    const refund = Math.floor(lab.total_spent * LAB.sellRefund);
    const { newBalance } = await adjustBalance(guildId, userId, refund, 'lab:sell');
    return { ok: true as const, refund, cash: newBalance };
  });
}

// ─── Investments ─────────────────────────────────────────────────────────────

export type InvestmentRow = { user_id: string; kind: string; cost: number; started_at: number; ends_at: number };

export async function getInvestment(userId: string): Promise<InvestmentRow | null> {
  const [row] = await db`SELECT * FROM eco_investment WHERE user_id = ${userId}`;
  return (row as InvestmentRow) ?? null;
}

export async function startInvestment(guildId: string, userId: string, kind: string) {
  const def = INVESTMENTS[kind];
  if (!def) return { ok: false as const, reason: 'unknown' as const };
  return withLock(lockKey(userId), async () => {
    if (await getInvestment(userId)) return { ok: false as const, reason: 'active' as const };
    const paid = await adjustBalance(guildId, userId, -def.cost, `invest:start:${kind}`);
    if (!paid.success) return { ok: false as const, reason: 'funds' as const, cash: paid.newBalance };
    const now = Date.now();
    await db`INSERT INTO eco_investment (user_id, kind, cost, started_at, ends_at) VALUES (${userId}, ${kind}, ${def.cost}, ${now}, ${now + def.durationMs})`;
    return { ok: true as const, def, endsAt: now + def.durationMs, cash: paid.newBalance };
  });
}

export async function completeInvestment(guildId: string, userId: string, roll: () => number = rand) {
  return withLock(lockKey(userId), async () => {
    const inv = await getInvestment(userId);
    if (!inv) return { ok: false as const, reason: 'none' as const };
    if (inv.ends_at > Date.now()) return { ok: false as const, reason: 'pending' as const, endsAt: inv.ends_at };
    const gone = await db`DELETE FROM eco_investment WHERE user_id = ${userId} AND kind = ${inv.kind} RETURNING kind`;
    if (!gone.length) return { ok: false as const, reason: 'none' as const };
    const def = INVESTMENTS[inv.kind]!;
    const success = roll() < def.chance;
    const payout = Math.floor(inv.cost * (success ? def.win : def.lose));
    const cash = payout > 0
      ? (await adjustBalance(guildId, userId, payout, `invest:${success ? 'win' : 'loss'}:${inv.kind}`)).newBalance
      : await getCash(guildId, userId);
    return { ok: true as const, success, payout, cost: inv.cost, def, cash };
  });
}

// ─── Quests ──────────────────────────────────────────────────────────────────

export type QuestRow = { user_id: string; difficulty: string; title: string; reward: number; started_at: number; ends_at: number };

export async function getQuest(userId: string): Promise<QuestRow | null> {
  const [row] = await db`SELECT * FROM eco_quest WHERE user_id = ${userId}`;
  return (row as QuestRow) ?? null;
}

export async function startQuest(userId: string, difficulty: string) {
  const tier = QUEST_TIERS[difficulty];
  if (!tier) return { ok: false as const, reason: 'unknown' as const };
  return withLock(lockKey(userId), async () => {
    if (await getQuest(userId)) return { ok: false as const, reason: 'active' as const };
    const now = Date.now();
    const title = QUEST_TITLES[randInt(0, QUEST_TITLES.length - 1)]!;
    const reward = randInt(tier.min, tier.max);
    await db`INSERT INTO eco_quest (user_id, difficulty, title, reward, started_at, ends_at) VALUES (${userId}, ${difficulty}, ${title}, ${reward}, ${now}, ${now + tier.durationMs})`;
    return { ok: true as const, tier, title, reward, endsAt: now + tier.durationMs };
  });
}

export async function completeQuest(guildId: string, userId: string) {
  return withLock(lockKey(userId), async () => {
    const q = await getQuest(userId);
    if (!q) return { ok: false as const, reason: 'none' as const };
    if (q.ends_at > Date.now()) return { ok: false as const, reason: 'pending' as const, endsAt: q.ends_at };
    const gone = await db`DELETE FROM eco_quest WHERE user_id = ${userId} RETURNING user_id`;
    if (!gone.length) return { ok: false as const, reason: 'none' as const };
    const reward = Math.floor(q.reward * (await careerMultiplier(userId)));
    const { newBalance } = await adjustBalance(guildId, userId, reward, `quest:${q.difficulty}`);
    await db`INSERT INTO eco_quest_stats (user_id, completed, total_earned) VALUES (${userId}, 1, ${reward})
             ON CONFLICT(user_id) DO UPDATE SET completed = completed + 1, total_earned = total_earned + ${reward}`;
    return { ok: true as const, reward, quest: q, cash: newBalance };
  });
}

export async function stopQuest(userId: string) {
  return withLock(lockKey(userId), async () => {
    const gone = await db`DELETE FROM eco_quest WHERE user_id = ${userId} RETURNING difficulty`;
    return gone.length > 0;
  });
}

export async function questLeaderboard(userIds: string[] | null, limit = 10) {
  if (userIds) {
    if (!userIds.length) return [];
    return (await db`SELECT s.user_id AS user_id, s.completed AS completed, s.total_earned AS total_earned FROM eco_quest_stats s
      INNER JOIN json_each(${JSON.stringify(userIds)}) j ON s.user_id = j.value ORDER BY s.completed DESC, s.total_earned DESC LIMIT ${limit}`) as { user_id: string; completed: number; total_earned: number }[];
  }
  return (await db`SELECT user_id, completed, total_earned FROM eco_quest_stats ORDER BY completed DESC, total_earned DESC LIMIT ${limit}`) as { user_id: string; completed: number; total_earned: number }[];
}
