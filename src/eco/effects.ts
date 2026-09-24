import { db } from '../utils/db.js';

/**
 * Equipped trading cards give small passive bonuses (see CARD_CATEGORIES in catalog.ts).
 * One card per category may be equipped; a holo card counts double.
 */

export type Equipped = Record<string, { stars: number; holo: boolean; weight: number }>;

export async function getEquipped(userId: string): Promise<Equipped> {
  const rows = await db`SELECT category, stars, standard FROM eco_card WHERE owner_id = ${userId} AND equipped = 1`;
  const out: Equipped = {};
  for (const r of rows as { category: string; stars: number; standard: number }[]) {
    const holo = r.standard === 0;
    out[r.category] = { stars: r.stars, holo, weight: r.stars * (holo ? 2 : 1) };
  }
  return out;
}

const w = (e: Equipped, cat: string) => e[cat]?.weight ?? 0;

/** Multiplier for work/daily/weekly/monthly/yearly: +2% per ★. */
export async function careerMultiplier(userId: string): Promise<number> {
  return 1 + 0.02 * w(await getEquipped(userId), 'career');
}

/** Multiplier on gambling winnings: +1% per ★. */
export async function fortuneMultiplier(userId: string): Promise<number> {
  return 1 + 0.01 * w(await getEquipped(userId), 'fortune');
}

/** Extra rob success chance: +3% per ★ (absolute). */
export async function robBonus(userId: string): Promise<number> {
  return 0.03 * w(await getEquipped(userId), 'rogue');
}

/** Reduction of robbers' success chance against this user: −3% per ★ (absolute). */
export async function guardBonus(userId: string): Promise<number> {
  return 0.03 * w(await getEquipped(userId), 'guardian');
}

/** Bank capacity multiplier: +10% per ★. */
export async function bankCapMultiplier(userId: string): Promise<number> {
  return 1 + 0.1 * w(await getEquipped(userId), 'banker');
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
