import { defineGroup, pickSub } from '../../framework/group.js';
import { netSubs, cryptoSubs } from '../../subcommands/lookups/net.js';

export default defineGroup({ name: 'website', description: 'Website tools', scope: 'anywhere', subs: [pickSub(netSubs, 'website', 'screenshot')] });
