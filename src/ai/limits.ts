import { premiumConfigured } from '../premium/index.js';

/**
 * AI rate limits.
 *  • Free: AI_USER_LIMIT requests per rolling hour (default 20).
 *  • Premium: no per-user limit.
 *  • Everyone: an optional global daily cap (AI_DAILY_LIMIT) and a kill switch (AI_DISABLED=1), so a provider bill can't run away.
 * In memory only — a restart resets it, which is fine for cost control.
 */

const HOUR = 3_600_000, DAY = 86_400_000;
const perUser = new Map<string, number[]>();
let globalHits: number[] = [];

const intEnv = (k: string, d: number) => { const v = Number(Bun.env[k]); return Number.isFinite(v) && v >= 0 ? Math.floor(v) : d; };
export const freeLimit = () => intEnv('AI_USER_LIMIT', 20);

export type LimitResult = { ok: true; remaining: number | null } | { ok: false; reason: 'disabled' | 'user' | 'global'; retryAfterMs: number };

/** Counts one request against the person (unless premium exempts them from the per-user limit) and says whether it may proceed. */
export function checkLimit(userId: string, now = Date.now(), premium = false): LimitResult {
  if (Bun.env.AI_DISABLED === '1') return { ok: false, reason: 'disabled', retryAfterMs: 0 };
  const userMax = premium ? 0 : freeLimit(), dayMax = intEnv('AI_DAILY_LIMIT', 0);
  globalHits = globalHits.filter(t => now - t < DAY);
  if (dayMax && globalHits.length >= dayMax) return { ok: false, reason: 'global', retryAfterMs: DAY - (now - globalHits[0]!) };
  const hits = (perUser.get(userId) ?? []).filter(t => now - t < HOUR);
  if (userMax && hits.length >= userMax) { perUser.set(userId, hits); return { ok: false, reason: 'user', retryAfterMs: HOUR - (now - hits[0]!) }; }
  hits.push(now); perUser.set(userId, hits); globalHits.push(now);
  if (perUser.size > 5000) for (const [k, v] of perUser) if (!v.some(t => now - t < HOUR)) perUser.delete(k);
  return { ok: true, remaining: userMax ? userMax - hits.length : null };
}

/** Where a person stands right now, without counting a request. */
export function usage(userId: string, now = Date.now(), premium = false): { used: number; limit: number | null; remaining: number | null; resetsInMs: number | null } {
  const hits = (perUser.get(userId) ?? []).filter(t => now - t < HOUR);
  const limit = premium ? null : freeLimit() || null;
  return { used: hits.length, limit, remaining: limit == null ? null : Math.max(0, limit - hits.length), resetsInMs: hits.length ? HOUR - (now - hits[0]!) : null };
}

/** Give a request back (e.g. the provider failed, so it shouldn't count against the person). */
export function refund(userId: string): void {
  perUser.get(userId)?.pop();
  globalHits.pop();
}

export function resetLimits(): void { perUser.clear(); globalHits = []; }

export const formatWait = (ms: number) => {
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  return mins >= 90 ? `${Math.ceil(mins / 60)} hours` : `${mins} minute${mins === 1 ? '' : 's'}`;
};

export function limitMessage(r: Extract<LimitResult, { ok: false }>): string {
  if (r.reason === 'disabled') return 'The AI features are switched off on this bot right now.';
  const when = formatWait(r.retryAfterMs);
  if (r.reason === 'global') return `The bot's daily AI budget is used up — it resets in about ${when}.`;
  const upsell = premiumConfigured() ? ' Premium removes this limit — see `/premium buy`.' : '';
  return `You've used your ${freeLimit()} free AI requests for this hour — try again in about ${when}.${upsell}`;
}
