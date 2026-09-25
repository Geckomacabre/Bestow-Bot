import { defineGroup } from '../../framework/group.js';
import { privacySubs } from '../../subcommands/privacy/privacy.js';

export default defineGroup({ name: 'settings', description: 'Manage your Bestow settings and data', scope: 'anywhere', groups: [{ name: 'privacy', description: 'See, export or erase the data Bestow has about you', subs: privacySubs }] });
