import { defineGroup } from '../../framework/group.js';
import { giveawaySubs } from '../../subcommands/giveaway/giveaway.js';

export default defineGroup({ name: 'giveaway', description: 'Run giveaways in your server', scope: 'anywhere', subs: giveawaySubs });
