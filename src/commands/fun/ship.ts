import { hfrom } from '../../framework/heist.js';
import { defineLeaf, pickSub } from '../../framework/group.js';
import { funSubs } from '../../subcommands/fun/fun.js';

export default defineLeaf(hfrom('ship', pickSub(funSubs, 'ship'), { alias: { user: 'user1', other: 'user2' } }));
