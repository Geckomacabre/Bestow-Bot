import type { Entitlement } from 'discord.js';
import { EventModule } from '../feature';
import { applyEntitlement } from '../../premium/sync.js';

/** Live entitlement events from Discord's monetization system (subscription started/renewed/ended, gift purchased). */
const dm = (bot: { users: { fetch(id: string): Promise<{ send(c: string): Promise<unknown> }> } }) => async (id: string, content: string) => (await bot.users.fetch(id)).send(content);

const premiumModule: EventModule = {
  name: 'premium',
  handlers: {
    entitlementCreate: async ({ data: [e], bot }) => { await applyEntitlement(e as Entitlement, { dm: dm(bot) }); },
    entitlementUpdate: async ({ data: [, e], bot }) => { await applyEntitlement(e as Entitlement, { dm: dm(bot) }); },
    entitlementDelete: async ({ data: [e], bot }) => { await applyEntitlement({ ...(e as Entitlement), deleted: true, isActive: () => false } as Entitlement, { dm: dm(bot) }); },
  },
};

export default premiumModule;
