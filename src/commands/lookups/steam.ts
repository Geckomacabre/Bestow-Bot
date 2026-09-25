import { hfrom } from '../../framework/heist.js';
import { defineLeaf, pickSub } from '../../framework/group.js';
import { steamSubs } from '../../subcommands/lookups/games.js';

export default defineLeaf(hfrom('steam', pickSub(steamSubs, 'game')));
