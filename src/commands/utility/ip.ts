import { hfrom, hgroup } from '../../framework/heist.js';
import { pickSub } from '../../framework/group.js';
import { netSubs } from '../../subcommands/lookups/net.js';

export default hgroup({
  name: 'ip',
  subs: [
    hfrom('ip ping', pickSub(netSubs, 'ping'), { tweaks: { host: { maxLength: 253 } } }),
    hfrom('ip lookup', pickSub(netSubs, 'ip'), { alias: { target: 'ip' }, tweaks: { ip: { maxLength: 253 } } }),
  ],
});
