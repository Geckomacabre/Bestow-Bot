import { hgroup } from '../../framework/heist.js';
import { telegramSubs } from '../../subcommands/lookups/social.js';

// whois, connections, avatars, archive, mutuals and emoji are declined (see docs/heist-parity.json).
export default hgroup({ name: 'telegram', subs: telegramSubs });
