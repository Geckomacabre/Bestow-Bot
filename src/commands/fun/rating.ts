import { hfrom, hgroup } from '../../framework/heist.js';
import { hotcalcSub } from '../../subcommands/fun/heist.js';

// Heist's howgay / howautistic / ppsize are declined (see docs/heist-parity.json); /rate covers rating anything else.
export default hgroup({ name: 'rating', subs: [hfrom('rating hotcalc', hotcalcSub)] });
