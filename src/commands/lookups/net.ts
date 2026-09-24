import { defineGroup } from '../../framework/group.js';
import { netSubs } from '../../subcommands/lookups/net.js';

export default defineGroup({ name: 'net', description: 'Network tools: DNS, IP lookup, ping and website screenshots', scope: 'anywhere', subs: netSubs });
