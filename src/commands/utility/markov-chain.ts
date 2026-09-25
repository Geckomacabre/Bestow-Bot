import { defineLeaf, pickSub } from '../../framework/group.js';
import { toolsSubs, funTextSubs } from '../../subcommands/lookups/tools.js';

export default defineLeaf(pickSub(funTextSubs, 'markov'), { name: 'markov-chain' });
