import { db } from '../utils/db.js';

/**
 * Premium status and gift codes.
 * `premium_users` is a local mirror of who currently has premium (from a Discord entitlement, an owner grant, or a redeemed gift);
 * Discord stays the source of truth for paid subscriptions and this table is refreshed from entitlement events.
 */
export async function initPremiumSchema(): Promise<void> {
  await db`CREATE TABLE IF NOT EXISTS premium_users (
    user_id    TEXT PRIMARY KEY,
    source     TEXT NOT NULL DEFAULT 'grant',
    expires_at INTEGER,
    updated_at INTEGER NOT NULL
  )`;
  await db`CREATE TABLE IF NOT EXISTS premium_gifts (
    code        TEXT PRIMARY KEY,
    buyer_id    TEXT NOT NULL,
    days        INTEGER NOT NULL DEFAULT 30,
    created_at  INTEGER NOT NULL,
    redeemed_by TEXT,
    redeemed_at INTEGER,
    entitlement_id TEXT
  )`;
  await db`CREATE INDEX IF NOT EXISTS idx_premium_gifts_buyer ON premium_gifts (buyer_id)`;
  // One gift per purchase: the same Discord entitlement can never mint two codes (events can be delivered twice, and startup re-checks).
  await db`CREATE UNIQUE INDEX IF NOT EXISTS idx_premium_gifts_entitlement ON premium_gifts (entitlement_id) WHERE entitlement_id IS NOT NULL`;
}
