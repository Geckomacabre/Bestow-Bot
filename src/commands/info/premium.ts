import { defineGroup } from '../../framework/group.js';
import { premiumGroups, premiumSubs } from '../../subcommands/premium/premium.js';

export default defineGroup({ name: 'premium', description: 'Bestow Premium: unlimited AI, gifts and perks', scope: 'anywhere', subs: premiumSubs, groups: premiumGroups });
