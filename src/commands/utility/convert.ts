import { defineGroup, pickSub } from '../../framework/group.js';
import { toolsSubs, funTextSubs } from '../../subcommands/lookups/tools.js';

export default defineGroup({ name: 'convert', description: 'Convert units, currencies and IDs', scope: 'anywhere', subs: [pickSub(toolsSubs, 'convert', 'units')] });
