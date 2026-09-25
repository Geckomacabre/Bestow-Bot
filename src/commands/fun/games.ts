import { defineGroup } from '../../framework/group.js';
import { gameSubs } from '../../subcommands/games/games.js';

export default defineGroup({ name: 'games', description: 'Minigame related commands', subs: gameSubs });
