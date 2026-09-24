import { defineGroup } from '../../framework/group.js';
import { walletEditSubs } from '../../subcommands/eco/wallet.js';

export default defineGroup({
  name: 'wallet',
  description: 'Customise your wallet card',
  scope: 'guild',
  subs: walletEditSubs,
});
