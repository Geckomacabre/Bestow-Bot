import { defineGroup } from '../../framework/group.js';
import { valorantSubs } from '../../subcommands/lookups/games.js';

export default defineGroup({ name: 'valorant', description: 'Valorant agents, maps, weapons, skins and seasons', subs: valorantSubs });
