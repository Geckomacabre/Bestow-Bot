import { hgroup } from '../../framework/heist.js';
import { cashappSubs } from '../../subcommands/lookups/social.js';

export default hgroup({ name: 'cashapp', subs: cashappSubs });
