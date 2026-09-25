import { hfrom, hgroup } from '../../framework/heist.js';
import { valorantSubs } from '../../subcommands/lookups/games.js';
import { valorantPlayerSubs } from '../../subcommands/lookups/social.js';

const old = (n: string) => valorantSubs.find(s => s.name === n)!;
const player = (n: string) => valorantPlayerSubs.find(s => s.name === n)!;

// Heist's order: user, agents, maps, seasons, weapon, skin, store, match, history.
export default hgroup({
  name: 'valorant',
  subs: [
    player('user'),
    hfrom('valorant agents', old('agents')), hfrom('valorant maps', old('maps')), hfrom('valorant seasons', old('seasons')),
    hfrom('valorant weapon', old('weapon'), { tweaks: { name: { maxLength: 40 } } }), hfrom('valorant skin', old('skin'), { tweaks: { name: { maxLength: 60 } } }),
    player('store'), player('match'), player('history'),
  ],
});
