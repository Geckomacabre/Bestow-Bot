import { hgroup } from '../../framework/heist.js';
import { pinterestSubs } from '../../subcommands/lookups/social.js';

export default hgroup({ name: 'pinterest', subs: pinterestSubs });
