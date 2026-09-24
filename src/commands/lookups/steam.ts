import { defineGroup } from '../../framework/group.js';
import { steamSubs } from '../../subcommands/lookups/games.js';

export default defineGroup({ name: 'steam', description: 'Look up games on Steam', subs: steamSubs });
