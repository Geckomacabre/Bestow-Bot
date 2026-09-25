import { initPremiumSchema } from '../premium/schema.js';
import { initGiveawaySchema } from '../giveaway/schema.js';
import { initCustomizeSchema } from '../customize/accent.js';
import { initTagsSchema } from '../tags/store.js';

/** Schemas for the Heist-parity features. Each module owns its tables; this is the one place they are started. */
export async function initHeistSchemas(): Promise<void> {
  await initPremiumSchema();
  await initGiveawaySchema();
  await initCustomizeSchema();
  await initTagsSchema();
}
