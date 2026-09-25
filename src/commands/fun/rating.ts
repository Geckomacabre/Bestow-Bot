import { defineGroup, pickSub } from '../../framework/group.js';
import { funSubs } from '../../subcommands/fun/fun.js';
import { hotcalcSub } from '../../subcommands/fun/heist.js';

export default defineGroup({ name: 'rating', description: 'Rate someone or something', subs: [hotcalcSub, pickSub(funSubs, 'rate')] });
