import { getGuildDroughtClaim, setGuildDroughtClaim } from './db.js';

export const DROUGHT_MAX_PAYOUT = 1_000_000;

export interface DroughtTuning {
  type: string;
  thresholdMs: number; // idle time (since anyone in the guild last claimed) before any bonus kicks in
  doublingMs: number;  // idle time beyond the threshold for the payout to double again
}

export interface DroughtResult {
  amount: number;
  multiplier: number;
  boosted: boolean;
}

// The longer NOBODY in the guild has claimed this command, the bigger the
// payout — it doubles every `doublingMs` of idle time past `thresholdMs`,
// capped at DROUGHT_MAX_PAYOUT so the jackpot stays rare rather than
// game-breaking. A guild's very first-ever claim of a type gets no bonus —
// there's no real drought to measure yet, just an empty history.
export async function applyDroughtBonus(guildId: string, base: number, tuning: DroughtTuning): Promise<DroughtResult> {
  const lastClaim = await getGuildDroughtClaim(guildId, tuning.type);
  const idleMs = lastClaim > 0 ? Date.now() - lastClaim : 0;
  await setGuildDroughtClaim(guildId, tuning.type);

  if (idleMs <= tuning.thresholdMs) return { amount: base, multiplier: 1, boosted: false };

  const excessMs = idleMs - tuning.thresholdMs;
  const multiplier = Math.pow(2, excessMs / tuning.doublingMs);
  const amount = Math.min(DROUGHT_MAX_PAYOUT, Math.round(base * multiplier));
  return { amount, multiplier, boosted: amount > base };
}

/** A message line to append when a drought bonus applied — empty string otherwise. */
export function droughtNote(result: DroughtResult): string {
  if (!result.boosted) return '';
  if (result.amount >= DROUGHT_MAX_PAYOUT) return '\n🎰 **JACKPOT!!** Nobody claimed this in ages — you hit the max payout!';
  if (result.multiplier >= 100) return '\n🎰 **MASSIVE DROUGHT BONUS!** This one sat unclaimed for a long time!';
  if (result.multiplier >= 10) return '\n💰 **Drought Bonus!** No one\'s claimed this in a while — nice boost!';
  return '\n🔥 *Idle bonus — this one sat unclaimed for a bit.*';
}
