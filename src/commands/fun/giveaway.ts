import { hfrom, hgroup } from '../../framework/heist.js';
import { giveawaySubs } from '../../subcommands/giveaway/giveaway.js';

export default hgroup({
  name: 'giveaway',
  subs: ['start', 'cancel', 'edit', 'end', 'reroll', 'list'].map(n => {
    const s = giveawaySubs.find(x => x.name === n)!;
    return hfrom(`giveaway ${n}`, s, { permissions: s.permissions, guildOnly: s.guildOnly, tweaks: { prize: { maxLength: 200 }, duration: { maxLength: 20 }, message_id: { maxLength: 25 }, winners: { min: 1, max: 50 } } });
  }),
});
