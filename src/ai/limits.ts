/**
 * Per-user sliding-window rate limit plus an optional global daily cap, so an AI provider bill can't be run up by one person (or a script).
 * In memory only: a restart resets it, which is fine for cost control.
 * Env: AI_USER_LIMIT (requests/hour/user, default 20; 0 = unlimited), AI_DAILY_LIMIT (requests/day total; default 0 = unlimited), AI_DISABLED=1 (kill switch).
 */

const HOUR = 3_600_000, DAY = 86_400_000;
const perUser = new Map<string, number[]>();
let globalHits: number[] = [];

const intEnv = (k: string, d: number) => { const v = Number(Bun.env[k]); return Number.isFinite(v) && v >= 0 ? Math.floor(v) : d; };

export type LimitResult = { ok: true; remaining: number | null } | { ok: false; reason: 'disabled' | 'user' | 'global'; retryAfterMs: number };

export function checkLimit(userId: string, now = Date.now()): LimitResult {
  if (Bun.env.AI_DISABLED === '1') return { ok: false, reason: 'disabled', retryAfterMs: 0 };
  const userMax = intEnv('AI_USER_LIMIT', 20), dayMax = intEnv('AI_DAILY_LIMIT', 0);
  globalHits = globalHits.filter(t => now - t < DAY);
  if (dayMax && globalHits.length >= dayMax) return { ok: false, reason: 'global', retryAfterMs: DAY - (now - globalHits[0]!) };
  const hits = (perUser.get(userId) ?? []).filter(t => now - t < HOUR);
  if (userMax && hits.length >= userMax) { perUser.set(userId, hits); return { ok: false, reason: 'user', retryAfterMs: HOUR - (now - hits[0]!) }; }
  hits.push(now); perUser.set(userId, hits); globalHits.push(now);
  if (perUser.size > 5000) for (const [k, v] of perUser) if (!v.some(t => now - t < HOUR)) perUser.delete(k);
  return { ok: true, remaining: userMax ? userMax - hits.length : null };
}

/** Give a request back (e.g. the provider failed, so it shouldn't count against the person). */
export function refund(userId: string): void {
  perUser.get(userId)?.pop();
  globalHits.pop();
}

export function resetLimits(): void { perUser.clear(); globalHits = []; }

export function limitMessage(r: Extract<LimitResult, { ok: false }>): string {
  if (r.reason === 'disabled') return 'The AI features are switched off on this bot right now.';
  const mins = Math.max(1, Math.ceil(r.retryAfterMs / 60_000));
  const when = mins >= 90 ? `${Math.ceil(mins / 60)} hours` : `${mins} minute${mins === 1 ? '' : 's'}`;
  return r.reason === 'user' ? `You've hit your AI limit for now — try again in about ${when}.` : `The bot's daily AI budget is used up — it resets in about ${when}.`;
}
