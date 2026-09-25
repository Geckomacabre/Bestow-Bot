import { hgroup } from '../../framework/heist.js';
import { audioSubs } from '../../subcommands/media/media.js';

export default hgroup({ name: 'audio', subs: audioSubs });
