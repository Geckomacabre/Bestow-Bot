import { defineGroup } from '../../framework/group.js';
import { funSubs, funGroups } from '../../subcommands/fun/fun.js';

export default defineGroup({ name: 'juul', description: 'A totally fictional virtual vape', scope: 'anywhere', subs: funGroups[0]!.subs });
