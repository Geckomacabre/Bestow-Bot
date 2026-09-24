import { defineGroup } from '../../framework/group.js';
import { audioSubs } from '../../subcommands/media/media.js';

export default defineGroup({
  name: 'audio',
  description: 'Apply audio effects to a song or clip',
  subs: audioSubs,
});
