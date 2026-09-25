import { defineGroup } from '../../framework/group.js';
import { privacySubs } from '../../subcommands/privacy/privacy.js';

/** Bestow's own: see, export or erase everything stored about you. (Also reachable from the /settings panel.) */
export default defineGroup({ name: 'privacy', description: 'See, export or erase the data Bestow has about you', scope: 'anywhere', subs: privacySubs });
