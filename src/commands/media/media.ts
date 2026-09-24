import { defineGroup } from '../../framework/group.js';
import { imageSubs, mediaDirectSubs, videoSubs } from '../../subcommands/media/media.js';

export default defineGroup({
  name: 'media',
  description: 'Edit images, GIFs and videos',
  subs: mediaDirectSubs,
  groups: [
    { name: 'image', description: 'Image and GIF effects', subs: imageSubs },
    { name: 'video', description: 'Video tools', subs: videoSubs },
  ],
});
