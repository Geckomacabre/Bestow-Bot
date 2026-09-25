import { hfrom, hgroup } from '../../framework/heist.js';
import { fortniteSubs } from '../../subcommands/lookups/games.js';
import { fortniteUserSub } from '../../subcommands/lookups/social.js';

const old = (n: string) => fortniteSubs.find(s => s.name === n)!;
export default hgroup({ name: 'fortnite', subs: [hfrom('fortnite shop', old('shop')), hfrom('fortnite map', old('map')), fortniteUserSub, hfrom('fortnite cosmetic', old('cosmetic'), { tweaks: { name: { maxLength: 60 } } })] });
