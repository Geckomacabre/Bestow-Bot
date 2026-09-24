import { defineGroup } from '../../framework/group.js';
import { aiGroups, aiSubs } from '../../subcommands/ai/ai.js';

export default defineGroup({ name: 'ai', description: 'AI tools: ask, image reading, transcripts, fact-checks and fun bits', scope: 'anywhere', subs: aiSubs, groups: aiGroups });
