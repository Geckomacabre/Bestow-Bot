import { defineGroup, pickSub } from '../../framework/group.js';
import { netSubs, cryptoSubs } from '../../subcommands/lookups/net.js';

export default defineGroup({ name: 'dns', description: 'DNS tools', scope: 'anywhere', subs: [pickSub(netSubs, 'dns', 'lookup')] });
