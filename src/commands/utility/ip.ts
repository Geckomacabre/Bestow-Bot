import { defineGroup, pickSub } from '../../framework/group.js';
import { netSubs, cryptoSubs } from '../../subcommands/lookups/net.js';

export default defineGroup({ name: 'ip', description: 'IP address tools', scope: 'anywhere', subs: [pickSub(netSubs, 'ip', 'lookup'), pickSub(netSubs, 'ping')] });
