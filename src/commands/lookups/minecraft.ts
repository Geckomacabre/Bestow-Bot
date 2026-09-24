import { defineGroup } from '../../framework/group.js';
import { minecraftSubs } from '../../subcommands/lookups/games.js';

export default defineGroup({ name: 'minecraft', description: 'Minecraft lookups: servers, skins and players', subs: minecraftSubs });
