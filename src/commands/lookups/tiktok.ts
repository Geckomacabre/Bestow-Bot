import { hgroup } from '../../framework/heist.js';
import { tiktokSubs } from '../../subcommands/lookups/social.js';

// Heist's /tiktok country user|video are declined (location inference; see docs/heist-parity.json).
export default hgroup({ name: 'tiktok', subs: tiktokSubs });
