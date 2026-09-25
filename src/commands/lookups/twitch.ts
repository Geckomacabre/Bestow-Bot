import { hgroup } from '../../framework/heist.js';
import { twitchSubs } from '../../subcommands/lookups/social.js';

export default hgroup({ name: 'twitch', subs: twitchSubs });
