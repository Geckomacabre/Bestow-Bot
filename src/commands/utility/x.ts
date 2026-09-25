import { defineGroup, pickSub } from '../../framework/group.js';
import { toolsSubs, funTextSubs } from '../../subcommands/lookups/tools.js';

export default defineGroup({ name: 'x', description: 'X (Twitter) tools', scope: 'anywhere', subs: [pickSub(toolsSubs, 'tweet', 'repost')] });
