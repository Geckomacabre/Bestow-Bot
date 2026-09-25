import { defineLeaf, pickSub } from '../../framework/group.js';
import { funSubs, funGroups } from '../../subcommands/fun/fun.js';

export default defineLeaf(pickSub(funSubs, 'ascii'));
