import { getGuildDroughtClaim, setGuildDroughtClaim } from './db.js';

export interface DroughtTuning {
  type: string;
  thresholdMs: number; // idle time (since anyone in the guild last claimed) before any bonus kicks in
  rampMs: number;      // idle time beyond the threshold for the bonus to reach its cap
  maxBonus: number;    // the most the bonus adds, as a fraction of the payout (1 = up to double)
}

export interface DroughtResult {
  amount: number;
  multiplier: number;
  boosted: boolean;
}

// The longer NOBODY in the guild has claimed this command, the bigger the payout — a small nudge to come back, not a jackpot: the
// bonus grows evenly from the threshold and stops at `maxBonus` (at most double the payout), however long the command sat. A guild's
// very first-ever claim of a type gets no bonus — there's no real drought to measure yet, just an empty history.
export async function applyDroughtBonus(guildId: string, base: number, tuning: DroughtTuning): Promise<DroughtResult> {
  const lastClaim = await getGuildDroughtClaim(guildId, tuning.type);
  const idleMs = lastClaim > 0 ? Date.now() - lastClaim : 0;
  await setGuildDroughtClaim(guildId, tuning.type);
  return droughtPayout(base, idleMs, tuning);
}

/** The payout for `base` after `idleMs` with nobody claiming. */
export function droughtPayout(base: number, idleMs: number, tuning: Omit<DroughtTuning, 'type'>): DroughtResult {
  if (idleMs <= tuning.thresholdMs) return { amount: base, multiplier: 1, boosted: false };
  const multiplier = 1 + tuning.maxBonus * Math.min(1, (idleMs - tuning.thresholdMs) / tuning.rampMs);
  const amount = Math.round(base * multiplier);
  return { amount, multiplier, boosted: amount > base };
}

/** A message line to append when a drought bonus applied — empty string otherwise. */
export function droughtNote(result: DroughtResult): string {
  if (!result.boosted) return '';
  return `\n🔥 *Idle bonus +${Math.round((result.multiplier - 1) * 100)}% — nobody had claimed this in a while.*`;
}
