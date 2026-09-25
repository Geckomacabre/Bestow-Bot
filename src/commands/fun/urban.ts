import { hfrom } from '../../framework/heist.js';
import { defineLeaf, pickSub } from '../../framework/group.js';
import { funSubs } from '../../subcommands/fun/fun.js';

export default defineLeaf(hfrom('urban', pickSub(funSubs, 'urban'), { alias: { term: 'search' }, tweaks: { search: { maxLength: 100 } } }));
