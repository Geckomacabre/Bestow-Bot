import { defineGroup } from '../../framework/group.js';
import { fortniteSubs } from '../../subcommands/lookups/games.js';

export default defineGroup({ name: 'fortnite', description: 'Fortnite cosmetics, map and item shop', subs: fortniteSubs });
