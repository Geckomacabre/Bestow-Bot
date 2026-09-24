import { defineGroup } from '../../framework/group.js';
import { toolsSubs } from '../../subcommands/lookups/tools.js';

export default defineGroup({ name: 'tools', description: 'Handy tools: QR, colours, converter, calculator, lyrics, search and more', scope: 'anywhere', subs: toolsSubs });
