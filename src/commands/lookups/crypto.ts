import { defineGroup } from '../../framework/group.js';
import { cryptoSubs } from '../../subcommands/lookups/net.js';

export default defineGroup({ name: 'crypto', description: 'Crypto prices, wallets and network fees', scope: 'anywhere', subs: cryptoSubs });
