import { defineGroup, pickSub } from '../../framework/group.js';
import { cryptoSubs } from '../../subcommands/lookups/net.js';

export default defineGroup({
  name: 'crypto', description: 'Crypto prices, wallets and network fees', scope: 'anywhere',
  subs: [pickSub(cryptoSubs, 'price'), pickSub(cryptoSubs, 'top', 'rates'), pickSub(cryptoSubs, 'wallet'), pickSub(cryptoSubs, 'gas'), pickSub(cryptoSubs, 'convert')],
});
