import { hgroup } from '../../framework/heist.js';
import { instagramSubs } from '../../subcommands/lookups/social.js';

export default hgroup({ name: 'instagram', subs: instagramSubs });
