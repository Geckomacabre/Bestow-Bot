import { defineGroup, pickSub } from '../../framework/group.js';
import { toolsSubs, funTextSubs } from '../../subcommands/lookups/tools.js';

export default defineGroup({ name: 'color', description: 'Colour tools', scope: 'anywhere', subs: [pickSub(toolsSubs, 'color', 'inspect'), pickSub(toolsSubs, 'palette'), pickSub(toolsSubs, 'gradient')] });
