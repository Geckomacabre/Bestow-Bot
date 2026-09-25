import { hgroup } from '../../framework/heist.js';
import { mediaDirectSubs, mediaGroups } from '../../subcommands/media/media.js';

export default hgroup({ name: 'media', subs: mediaDirectSubs, groups: mediaGroups });
