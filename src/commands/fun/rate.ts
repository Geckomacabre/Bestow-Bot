import { hfrom } from '../../framework/heist.js';
import { defineLeaf, pickSub } from '../../framework/group.js';
import { funSubs } from '../../subcommands/fun/fun.js';

export default defineLeaf(hfrom('rate', pickSub(funSubs, 'rate'), { tweaks: { thing: { maxLength: 100 } } }));
