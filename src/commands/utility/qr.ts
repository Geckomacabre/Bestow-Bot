import { defineGroup, pickSub } from '../../framework/group.js';
import { toolsSubs, funTextSubs } from '../../subcommands/lookups/tools.js';

export default defineGroup({ name: 'qr', description: 'QR code tools', scope: 'anywhere', subs: [pickSub(toolsSubs, 'qr', 'generate'), pickSub(toolsSubs, 'qr-scan', 'scan')] });
