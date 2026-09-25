import { hfrom, hgroup } from '../../framework/heist.js';
import { pickSub } from '../../framework/group.js';
import { premiumGroups, premiumSubs } from '../../subcommands/premium/premium.js';

// Owner-only grant/revoke live in /staff (support server only), like Heist's hidden staff commands.
const gifts = premiumGroups[0]!.subs;
export default hgroup({
  name: 'premium',
  subs: ['perks', 'buy', 'syncrole'].map(n => hfrom(`premium ${n}`, pickSub(premiumSubs, n))),
  groups: [{ name: 'gifts', description: 'Gift Premium to your friends', subs: ['buy', 'inventory', 'redeem'].map(n => hfrom(`premium gifts ${n}`, pickSub(gifts, n), { tweaks: n === 'redeem' ? { code: { maxLength: 40 } } : {} })) }],
});
