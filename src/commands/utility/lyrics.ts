import { hfrom } from '../../framework/heist.js';
import { defineLeaf, pickSub } from '../../framework/group.js';
import { toolsSubs } from '../../subcommands/lookups/tools.js';

export default defineLeaf(hfrom('lyrics', pickSub(toolsSubs, 'lyrics')));
