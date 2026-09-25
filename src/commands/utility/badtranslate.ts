import { hfrom } from '../../framework/heist.js';
import { defineLeaf, pickSub } from '../../framework/group.js';
import { funTextSubs } from '../../subcommands/lookups/tools.js';

export default defineLeaf(hfrom('badtranslate', pickSub(funTextSubs, 'badtranslate'), { tweaks: { text: { maxLength: 300 }, count: { min: 2, max: 8 } } }));
