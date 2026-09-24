import { defineGroup } from '../../framework/group.js';
import { youtubeSubs } from '../../subcommands/lookups/games.js';

export default defineGroup({ name: 'youtube', description: 'Search YouTube', subs: youtubeSubs });
