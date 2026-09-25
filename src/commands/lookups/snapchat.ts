import { hgroup } from '../../framework/heist.js';
import { snapchatSubs } from '../../subcommands/lookups/social.js';

export default hgroup({ name: 'snapchat', subs: snapchatSubs });
