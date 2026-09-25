import { db } from '../utils/db.js';

/**
 * Equipped trading cards give small passive bonuses in Heist's three categories — Business, Lab and Personal (see
 * CARD_CATEGORIES in catalog.ts). One card per category may be equipped; a holo card counts double.
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

/** Personal card — work, claims and quest rewards: +2% per ★. */
export async function careerMultiplier(userId: string): Promise<number> {
  return 1 + 0.02 * w(await getEquipped(userId), 'personal');
}

/** Business card — business income: +3% per ★. */
export async function businessMultiplier(userId: string): Promise<number> {
  return 1 + 0.03 * w(await getEquipped(userId), 'business');
}

/** Lab card — lab output: +3% per ★. */
export async function labMultiplier(userId: string): Promise<number> {
  return 1 + 0.03 * w(await getEquipped(userId), 'lab');
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
