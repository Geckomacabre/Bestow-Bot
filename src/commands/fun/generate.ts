import { defineGroup } from '../../framework/group.js';
import { generateSubs } from '../../subcommands/fun/generate.js';

export default defineGroup({ name: 'generate', description: 'Make joke images: fake messages, replies, conversations and tombstones', scope: 'anywhere', subs: generateSubs });
