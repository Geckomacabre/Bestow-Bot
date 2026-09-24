import { defineGroup } from '../../framework/group.js';
import { robloxSubs } from '../../subcommands/lookups/roblox.js';

export default defineGroup({ name: 'roblox', description: 'Roblox lookups: users, groups, games, items and calculators', subs: robloxSubs });
