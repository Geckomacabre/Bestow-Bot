import { defineGroup } from '../../framework/group.js';
import { privacySubs } from '../../subcommands/privacy/privacy.js';

export default defineGroup({ name: 'privacy', description: 'See, export or erase the data this bot has about you', scope: 'anywhere', subs: privacySubs });
