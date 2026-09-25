import { hfrom } from '../../framework/heist.js';
import { defineLeaf, pickSub } from '../../framework/group.js';
import { funTextSubs } from '../../subcommands/lookups/tools.js';

export default defineLeaf(hfrom('markov-chain', pickSub(funTextSubs, 'markov'), { tweaks: { text: { maxLength: 2000 } } }));
