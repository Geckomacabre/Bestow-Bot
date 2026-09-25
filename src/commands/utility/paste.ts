import { hfrom } from '../../framework/heist.js';
import { defineLeaf, pickSub } from '../../framework/group.js';
import { toolsSubs } from '../../subcommands/lookups/tools.js';

export default defineLeaf(hfrom('paste', pickSub(toolsSubs, 'paste'), { tweaks: { text: { maxLength: 4000 }, title: { maxLength: 100 } } }));
