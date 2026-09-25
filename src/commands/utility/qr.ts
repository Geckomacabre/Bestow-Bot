import { hfrom, hgroup } from '../../framework/heist.js';
import { pickSub } from '../../framework/group.js';
import { toolsSubs } from '../../subcommands/lookups/tools.js';

export default hgroup({
  name: 'qr',
  subs: [
    hfrom('qr generate', pickSub(toolsSubs, 'qr'), { tweaks: { text: { maxLength: 1000 } } }),
    hfrom('qr scan', pickSub(toolsSubs, 'qr-scan')),
  ],
});
