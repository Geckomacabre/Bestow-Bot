import { hfrom, hgroup } from '../../framework/heist.js';
import { minecraftSubs } from '../../subcommands/lookups/games.js';
import { minecraftRandomSub } from '../../subcommands/lookups/social.js';

const old = (n: string) => minecraftSubs.find(s => s.name === n)!;
export default hgroup({
  name: 'minecraft',
  subs: [hfrom('minecraft user', old('user'), { tweaks: { username: { maxLength: 16 } } }), hfrom('minecraft skin', old('skin'), { tweaks: { username: { maxLength: 16 } } }), hfrom('minecraft server', old('server'), { tweaks: { address: { maxLength: 100 } } }), minecraftRandomSub],
});
