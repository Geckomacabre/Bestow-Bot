import { db, adjustBalance } from '../utils/db.js';
import { withLock } from '../framework/mutex.js';
import { rand, randInt } from '../utils/random.js';
import { CARD_CATEGORIES, CARD_SHRED_VALUE, CASES, HOLO_CHANCE, HOLO_SHRED_MULT, MAX_STARS, MERGE_COUNT } from './catalog.js';
import { moveCash } from './core.js';

export type CardRow = {
  id: number; owner_id: string; category: string; name: string; stars: number; standard: number; equipped: number; created_at: number;
};

const lockKey = (userId: string) => `eco:${userId}`;
export const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(Math.max(0, MAX_STARS - n));
export const cardLabel = (c: Pick<CardRow, 'name' | 'stars' | 'standard'>) => `${c.standard ? '' : '✨ '}${c.name} ${'★'.repeat(c.stars)}`;

export function shredValue(c: Pick<CardRow, 'stars' | 'standard'>): number {
  return (CARD_SHRED_VALUE[c.stars] ?? 0) * (c.standard ? 1 : HOLO_SHRED_MULT);
}

/** Pick 1–5★ using a case's odds. `r` is injectable for tests. */
export function rollStars(odds: readonly number[], r: number = rand()): number {
  let acc = 0;
  for (let i = 0; i < odds.length; i++) {
    acc += odds[i]!;
    if (r < acc) return i + 1;
  }
  return odds.length;
}

function pickName(category: string): string {
  const names = CARD_CATEGORIES[category]!.names;
  return names[randInt(0, names.length - 1)]!;
}

// ─── Cases ───────────────────────────────────────────────────────────────────

export async function getCases(userId: string): Promise<Record<string, number>> {
  const rows = await db`SELECT case_type, qty FROM eco_case WHERE user_id = ${userId} AND qty > 0`;
  return Object.fromEntries((rows as { case_type: string; qty: number }[]).map(r => [r.case_type, r.qty]));
}

export async function buyCases(guildId: string, userId: string, caseType: string, amount: number) {
  const def = CASES[caseType];
  if (!def) return { ok: false as const, reason: 'unknown' as const };
  return withLock(lockKey(userId), async () => {
    const cost = def.cost * amount;
    const paid = await adjustBalance(guildId, userId, -cost, `card:buy:${caseType}`);
    if (!paid.success) return { ok: false as const, reason: 'funds' as const, cost, cash: paid.newBalance };
    await db`INSERT INTO eco_case (user_id, case_type, qty) VALUES (${userId}, ${caseType}, ${amount})
             ON CONFLICT(user_id, case_type) DO UPDATE SET qty = qty + ${amount}`;
    return { ok: true as const, def, cost, cash: paid.newBalance };
  });
}

export async function openCases(userId: string, caseType: string, amount: number, category?: string | null) {
  const def = CASES[caseType];
  if (!def) return { ok: false as const, reason: 'unknown' as const };
  if (category && !CARD_CATEGORIES[category]) return { ok: false as const, reason: 'category' as const };
  return withLock(lockKey(userId), async () => {
    const took = await db`UPDATE eco_case SET qty = qty - ${amount} WHERE user_id = ${userId} AND case_type = ${caseType} AND qty >= ${amount} RETURNING qty`;
    if (!took.length) return { ok: false as const, reason: 'none' as const };
    const cats = Object.keys(CARD_CATEGORIES);
    const pulled: CardRow[] = [];
    const now = Date.now();
    for (let i = 0; i < amount; i++) {
      const cat = category ?? cats[randInt(0, cats.length - 1)]!;
      const st = rollStars(def.odds);
      const holo = rand() < HOLO_CHANCE;
      const name = pickName(cat);
      const [row] = await db`INSERT INTO eco_card (owner_id, category, name, stars, standard, equipped, created_at)
        VALUES (${userId}, ${cat}, ${name}, ${st}, ${holo ? 0 : 1}, 0, ${now}) RETURNING *`;
      pulled.push(row as CardRow);
    }
    return { ok: true as const, def, cards: pulled };
  });
}

// ─── Collection ──────────────────────────────────────────────────────────────

export async function listCards(userId: string, category?: string | null): Promise<CardRow[]> {
  if (category) return (await db`SELECT * FROM eco_card WHERE owner_id = ${userId} AND category = ${category} ORDER BY equipped DESC, stars DESC, standard ASC, id ASC`) as CardRow[];
  return (await db`SELECT * FROM eco_card WHERE owner_id = ${userId} ORDER BY equipped DESC, stars DESC, standard ASC, id ASC`) as CardRow[];
}

export async function getCard(cardId: number): Promise<CardRow | null> {
  const [row] = await db`SELECT * FROM eco_card WHERE id = ${cardId}`;
  return (row as CardRow) ?? null;
}

export async function equipCard(userId: string, cardId: number) {
  return withLock(lockKey(userId), async () => {
    const card = await getCard(cardId);
    if (!card || card.owner_id !== userId) return { ok: false as const, reason: 'notyours' as const };
    await db`UPDATE eco_card SET equipped = 0 WHERE owner_id = ${userId} AND category = ${card.category}`;
    await db`UPDATE eco_card SET equipped = 1 WHERE id = ${cardId} AND owner_id = ${userId}`;
    return { ok: true as const, card };
  });
}

export async function unequipCategory(userId: string, category: string): Promise<boolean> {
  return withLock(lockKey(userId), async () => {
    const rows = await db`UPDATE eco_card SET equipped = 0 WHERE owner_id = ${userId} AND category = ${category} AND equipped = 1 RETURNING id`;
    return rows.length > 0;
  });
}

export async function shredCard(guildId: string, userId: string, cardId: number) {
  return withLock(lockKey(userId), async () => {
    const card = await getCard(cardId);
    if (!card || card.owner_id !== userId) return { ok: false as const, reason: 'notyours' as const };
    const gone = await db`DELETE FROM eco_card WHERE id = ${cardId} AND owner_id = ${userId} RETURNING id`;
    if (!gone.length) return { ok: false as const, reason: 'notyours' as const };
    const value = shredValue(card);
    const { newBalance } = await adjustBalance(guildId, userId, value, 'card:shred');
    return { ok: true as const, card, value, cash: newBalance };
  });
}

/** Merge MERGE_COUNT same-star standard cards of a category into one card a star higher. */
export async function mergeCards(userId: string, category: string, starLevel: number) {
  if (!CARD_CATEGORIES[category]) return { ok: false as const, reason: 'category' as const };
  if (starLevel < 1 || starLevel >= MAX_STARS) return { ok: false as const, reason: 'max' as const };
  return withLock(lockKey(userId), async () => {
    // Prefer to burn unequipped cards first.
    const rows = await db`SELECT id FROM eco_card WHERE owner_id = ${userId} AND category = ${category} AND stars = ${starLevel} AND standard = 1
      ORDER BY equipped ASC, id ASC LIMIT ${MERGE_COUNT}`;
    if ((rows as { id: number }[]).length < MERGE_COUNT) return { ok: false as const, reason: 'few' as const, have: rows.length };
    const ids = (rows as { id: number }[]).map(r => r.id);
    const del = await db`DELETE FROM eco_card WHERE owner_id = ${userId} AND id IN (SELECT value FROM json_each(${JSON.stringify(ids)})) RETURNING id`;
    if (del.length !== MERGE_COUNT) return { ok: false as const, reason: 'few' as const, have: del.length };
    const [row] = await db`INSERT INTO eco_card (owner_id, category, name, stars, standard, equipped, created_at)
      VALUES (${userId}, ${category}, ${pickName(category)}, ${starLevel + 1}, 1, 0, ${Date.now()}) RETURNING *`;
    return { ok: true as const, card: row as CardRow };
  });
}

// ─── Player-to-player ────────────────────────────────────────────────────────

/** Executes an already-agreed sale. Ownership flips first (conditionally); if the payment then fails it flips back. */
export async function executeCardSale(sellerId: string, buyerId: string, cardId: number, price: number, guildId: string) {
  const moved = await db`UPDATE eco_card SET owner_id = ${buyerId}, equipped = 0 WHERE id = ${cardId} AND owner_id = ${sellerId} RETURNING id`;
  if (!moved.length) return { ok: false as const, reason: 'gone' as const };
  const paid = await moveCash(guildId, buyerId, sellerId, price, 'card:sale');
  if (!paid) {
    await db`UPDATE eco_card SET owner_id = ${sellerId} WHERE id = ${cardId} AND owner_id = ${buyerId}`;
    return { ok: false as const, reason: 'funds' as const };
  }
  return { ok: true as const };
}

export async function executeCardTrade(aId: string, aCardId: number, bId: string, bCardId: number) {
  const first = await db`UPDATE eco_card SET owner_id = ${bId}, equipped = 0 WHERE id = ${aCardId} AND owner_id = ${aId} RETURNING id`;
  if (!first.length) return { ok: false as const, reason: 'gone' as const };
  const second = await db`UPDATE eco_card SET owner_id = ${aId}, equipped = 0 WHERE id = ${bCardId} AND owner_id = ${bId} RETURNING id`;
  if (!second.length) {
    await db`UPDATE eco_card SET owner_id = ${aId} WHERE id = ${aCardId} AND owner_id = ${bId}`;
    return { ok: false as const, reason: 'gone' as const };
  }
  return { ok: true as const };
}
