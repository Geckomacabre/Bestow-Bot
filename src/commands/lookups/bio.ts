import { hgroup } from '../../framework/heist.js';
import { bioSubs } from '../../subcommands/lookups/social.js';

export default hgroup({ name: 'bio', subs: bioSubs });
