import type { Client, Entitlement } from 'discord.js';
import { createGift, giftSku, premiumSku, revokePremium, setPremium, premiumStatus } from './index.js';

/**
 * Keeps local premium state in step with Discord's entitlements. Used both for live events and for a startup / periodic
 * re-check, so a purchase made while the bot was offline (or an event that was missed) is still honoured.
 */

export type DmFn = (userId: string, content: string) => Promise<unknown>;

/** Applies one entitlement. Returns what happened (useful for logging and tests). */
export async function applyEntitlement(e: Pick<Entitlement, 'id' | 'skuId' | 'userId' | 'endsTimestamp' | 'deleted'> & { isActive?: () => boolean; consumed?: boolean; consume?: () => Promise<unknown> },
  o: { dm?: DmFn; now?: number } = {}): Promise<'premium' | 'ended' | 'gift' | 'gift-existing' | 'ignored'> {
  const now = o.now ?? Date.now();
  if (!e.userId) return 'ignored';
  const active = e.isActive ? e.isActive() : !e.deleted && (e.endsTimestamp == null || e.endsTimestamp > now);
  if (e.skuId === premiumSku()) {
    if (active) { await setPremium(e.userId, 'entitlement', e.endsTimestamp ?? null, now); return 'premium'; }
    // Only end premium that came from a subscription; a grant or gift the person also has must survive.
    const st = await premiumStatus(e.userId, { now });
    if (st.source === 'entitlement') await revokePremium(e.userId);
    return 'ended';
  }
  if (e.skuId === giftSku() && active && !e.consumed) {
    const gift = await createGift(e.userId, { entitlementId: e.id, now });
    if (gift.created) {
      await e.consume?.().catch(() => {});
      await o.dm?.(e.userId, `🎁 **Thanks for gifting Bestow Premium!** Your gift code is \`${gift.code}\` — send it to a friend and they can redeem it with \`/premium gifts redeem\`. You can see your codes any time with \`/premium gifts inventory\`.`).catch(() => {});
      return 'gift';
    }
    await e.consume?.().catch(() => {});
    return 'gift-existing';
  }
  return 'ignored';
}

/** Startup / periodic reconciliation against Discord's full entitlement list. */
export async function reconcile(client: Client, o: { dm?: DmFn } = {}): Promise<{ premium: number; gifts: number }> {
  const skus = [premiumSku(), giftSku()].filter((s): s is string => !!s);
  if (!skus.length || !client.application) return { premium: 0, gifts: 0 };
  const dm: DmFn = o.dm ?? (async (id, content) => (await client.users.fetch(id)).send(content));
  let premium = 0, gifts = 0;
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const list = await client.application.entitlements.fetch({ skus, excludeEnded: true, excludeDeleted: true, limit: 100, ...(after ? { after } : {}) });
    if (!list.size) break;
    for (const e of list.values()) {
      const r = await applyEntitlement(e, { dm });
      if (r === 'premium') premium++; else if (r === 'gift') gifts++;
    }
    if (list.size < 100) break;
    after = [...list.keys()].at(-1);
  }
  return { premium, gifts };
}

export function startPremiumSync(client: Client): void {
  if (!premiumSku() && !giftSku()) return;
  const run = () => reconcile(client).then(r => { if (r.premium || r.gifts) console.log(`[premium] synced ${r.premium} subscription(s), ${r.gifts} new gift(s)`); }).catch(err => console.error('[premium] sync failed:', (err as Error).message));
  void run();
  setInterval(run, 6 * 3_600_000).unref?.();
}
