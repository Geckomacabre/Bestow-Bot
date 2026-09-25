import type { Client, Entitlement } from 'discord.js';
import { db } from '../utils/db.js';
import { withLock } from '../framework/mutex.js';

/**
 * Bestow Premium. The only thing premium changes today is the AI rate limit (free: 20 requests/hour, premium: unlimited).
 *
 * How someone becomes premium:
 *  • buys the subscription through Discord itself (a "Premium App" SKU — Discord handles the payment; we only read the entitlement),
 *  • is granted it by a bot owner,
 *  • or redeems a gift code (bought through Discord as a consumable SKU).
 *
 * Env: PREMIUM_SKU_ID (subscription SKU), PREMIUM_GIFT_SKU_ID (consumable gift SKU), PREMIUM_GIFT_DAYS (default 30),
 *      PREMIUM_ROLE_ID + SUPPORT_GUILD_ID (optional role sync), OWNER_IDS (owners always have premium).
 */

export const DAY = 86_400_000;
export const premiumSku = () => Bun.env.PREMIUM_SKU_ID || null;
export const giftSku = () => Bun.env.PREMIUM_GIFT_SKU_ID || null;
export const giftDays = () => { const n = Number(Bun.env.PREMIUM_GIFT_DAYS); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30; };
export const premiumConfigured = () => !!premiumSku();

export const isOwner = (userId: string): boolean => (Bun.env.OWNER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean).includes(userId);

export interface PremiumStatus { premium: boolean; source: 'owner' | 'entitlement' | 'grant' | 'gift' | null; expiresAt: number | null }

interface Row { user_id: string; source: string; expires_at: number | null }

async function row(userId: string): Promise<Row | undefined> {
  return ((await db`SELECT user_id, source, expires_at FROM premium_users WHERE user_id = ${userId}`) as Row[])[0];
}

/** Stores/extends a premium record. `expiresAt: null` = no end date (an active subscription is refreshed by entitlement events). */
export async function setPremium(userId: string, source: 'entitlement' | 'grant' | 'gift', expiresAt: number | null, now = Date.now()): Promise<void> {
  await db`INSERT INTO premium_users (user_id, source, expires_at, updated_at) VALUES (${userId}, ${source}, ${expiresAt}, ${now})
    ON CONFLICT(user_id) DO UPDATE SET source = excluded.source, expires_at = excluded.expires_at, updated_at = excluded.updated_at`;
  cache.delete(userId);
}

/** Adds `days` to whatever time the person already has left (or starts from now). Returns the new expiry. */
export function extendPremium(userId: string, days: number, source: 'grant' | 'gift', now = Date.now()): Promise<number> {
  return withLock(`premium:${userId}`, async () => {
    const cur = await row(userId);
    // A no-expiry record (an active subscription) already covers them; a gift then just banks nothing extra but still succeeds.
    const base = cur && (cur.expires_at == null || cur.expires_at > now) ? (cur.expires_at ?? now) : now;
    const expiresAt = cur && cur.expires_at == null ? null : base + days * DAY;
    await setPremium(userId, cur && cur.expires_at == null ? (cur.source as 'entitlement') : source, expiresAt, now);
    return expiresAt ?? Number.POSITIVE_INFINITY;
  });
}

export async function revokePremium(userId: string): Promise<boolean> {
  const r = (await db`DELETE FROM premium_users WHERE user_id = ${userId} RETURNING user_id`) as unknown[];
  cache.delete(userId);
  return r.length > 0;
}

const cache = new Map<string, { at: number; value: boolean }>();
const CACHE_MS = 5 * 60_000;

/**
 * Whether a person currently has premium. Checks, in order: bot owner → local record → the entitlements Discord attached to this
 * very interaction → (if a client is given) Discord's entitlement list, cached for 5 minutes.
 */
export async function premiumStatus(userId: string, o: { entitlements?: Iterable<Entitlement>; client?: Client; now?: number } = {}): Promise<PremiumStatus> {
  const now = o.now ?? Date.now();
  if (isOwner(userId)) return { premium: true, source: 'owner', expiresAt: null };
  const r = await row(userId);
  if (r && (r.expires_at == null || r.expires_at > now)) return { premium: true, source: r.source as PremiumStatus['source'], expiresAt: r.expires_at };
  const sku = premiumSku();
  if (sku && o.entitlements) {
    for (const e of o.entitlements) {
      if (e.skuId === sku && e.userId === userId && (e.isActive?.() ?? !e.deleted)) {
        const ends = e.endsTimestamp ?? null;
        await setPremium(userId, 'entitlement', ends, now);
        return { premium: true, source: 'entitlement', expiresAt: ends };
      }
    }
  }
  if (sku && o.client?.application) {
    const hit = cache.get(userId);
    if (hit && now - hit.at < CACHE_MS) return hit.value ? { premium: true, source: 'entitlement', expiresAt: null } : { premium: false, source: null, expiresAt: null };
    let active = false;
    try {
      const list = await o.client.application.entitlements.fetch({ user: userId, skus: [sku], excludeEnded: true, excludeDeleted: true });
      const e = [...list.values()].find(x => x.isActive());
      if (e) { active = true; await setPremium(userId, 'entitlement', e.endsTimestamp ?? null, now); }
    } catch { /* Discord unreachable: treat as free rather than block anyone */ }
    cache.set(userId, { at: now, value: active });
    if (active) return { premium: true, source: 'entitlement', expiresAt: null };
  }
  return { premium: false, source: null, expiresAt: null };
}

export const hasPremium = async (userId: string, o: Parameters<typeof premiumStatus>[1] = {}) => (await premiumStatus(userId, o)).premium;

export function resetPremiumCache(): void { cache.clear(); }

// ─── Gift codes ──────────────────────────────────────────────────────────────

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
export function newGiftCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const c = [...bytes].map(b => ALPHABET[b % ALPHABET.length]).join('');
  return `BSTW-${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
}
/** Accepts a code however it was typed (lower case, spaces, missing dashes) and returns the canonical BSTW-XXXX-XXXX-XXXX form. */
export function normalizeCode(s: string): string {
  const flat = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = /^BSTW([A-Z0-9]{4})([A-Z0-9]{4})([A-Z0-9]{4})$/.exec(flat);
  return m ? `BSTW-${m[1]}-${m[2]}-${m[3]}` : flat;
}

export interface Gift { code: string; buyer_id: string; days: number; created_at: number; redeemed_by: string | null; redeemed_at: number | null }

/**
 * Mints a gift code. With `entitlementId` it is idempotent: the same Discord purchase always yields the same single code.
 * Returns `created: false` when that purchase already produced one.
 */
export async function createGift(buyerId: string, o: { days?: number; now?: number; entitlementId?: string } = {}): Promise<Gift & { created: boolean }> {
  const days = o.days ?? giftDays(), now = o.now ?? Date.now();
  if (o.entitlementId) {
    const prior = ((await db`SELECT * FROM premium_gifts WHERE entitlement_id = ${o.entitlementId}`) as Gift[])[0];
    if (prior) return { ...prior, created: false };
  }
  const code = newGiftCode();
  try {
    await db`INSERT INTO premium_gifts (code, buyer_id, days, created_at, entitlement_id) VALUES (${code}, ${buyerId}, ${days}, ${now}, ${o.entitlementId ?? null})`;
  } catch (err) {
    // A live event and the startup sync can deliver the same purchase at the same moment; the unique index lets exactly one win.
    const prior = o.entitlementId ? ((await db`SELECT * FROM premium_gifts WHERE entitlement_id = ${o.entitlementId}`) as Gift[])[0] : undefined;
    if (prior) return { ...prior, created: false };
    throw err;
  }
  return { code, buyer_id: buyerId, days, created_at: now, redeemed_by: null, redeemed_at: null, created: true };
}
export async function listGifts(buyerId: string): Promise<Gift[]> {
  return (await db`SELECT * FROM premium_gifts WHERE buyer_id = ${buyerId} ORDER BY created_at DESC LIMIT 25`) as Gift[];
}

export type RedeemResult = { ok: true; days: number; expiresAt: number } | { ok: false; reason: 'invalid' | 'used' | 'own' | 'active' };

/** Atomic: the UPDATE only succeeds while the gift is unredeemed, so two people can never both redeem one code. */
export async function redeemGift(rawCode: string, userId: string, now = Date.now()): Promise<RedeemResult> {
  const code = normalizeCode(rawCode);
  if (!/^BSTW-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return { ok: false, reason: 'invalid' };
  const existing = ((await db`SELECT * FROM premium_gifts WHERE code = ${code}`) as Gift[])[0];
  if (!existing) return { ok: false, reason: 'invalid' };
  if (existing.redeemed_by) return { ok: false, reason: 'used' };
  if (existing.buyer_id === userId) return { ok: false, reason: 'own' };
  // Someone with a running subscription (or an owner) has no use for extra days — don't burn the code.
  const st = await premiumStatus(userId, { now });
  if (st.premium && st.expiresAt == null) return { ok: false, reason: 'active' };
  const claimed = (await db`UPDATE premium_gifts SET redeemed_by = ${userId}, redeemed_at = ${now} WHERE code = ${code} AND redeemed_by IS NULL RETURNING days`) as { days: number }[];
  if (!claimed.length) return { ok: false, reason: 'used' };
  const expiresAt = await extendPremium(userId, claimed[0]!.days, 'gift', now);
  return { ok: true, days: claimed[0]!.days, expiresAt };
}

/** Premium check for a slash-command invocation: uses the entitlements Discord attached to the interaction itself. */
export const premiumOf = (i: { user: { id: string }; entitlements?: { values(): Iterable<Entitlement> }; client?: Client }) =>
  premiumStatus(i.user.id, { entitlements: i.entitlements?.values(), client: i.client });
