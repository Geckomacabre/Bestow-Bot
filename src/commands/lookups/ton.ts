import { hgroup } from '../../framework/heist.js';
import { tonSubs } from '../../subcommands/lookups/social.js';

export default hgroup({ name: 'ton', subs: tonSubs });
