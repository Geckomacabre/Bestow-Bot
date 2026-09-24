import { defineGroup } from '../../framework/group.js';
import { funGroups, funSubs } from '../../subcommands/fun/fun.js';

export default defineGroup({ name: 'fun', description: 'Fun and silly stuff: actions, ship, roast, juul and more', scope: 'anywhere', subs: funSubs, groups: funGroups });
