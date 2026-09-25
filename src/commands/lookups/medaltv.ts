import { hgroup } from '../../framework/heist.js';
import { medalSubs } from '../../subcommands/lookups/social.js';

export default hgroup({ name: 'medaltv', subs: medalSubs });
