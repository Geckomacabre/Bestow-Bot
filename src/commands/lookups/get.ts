import { hgroup } from '../../framework/heist.js';
import { getSubs } from '../../subcommands/lookups/social.js';

export default hgroup({ name: 'get', subs: getSubs });
