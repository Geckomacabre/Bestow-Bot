import { hgroup } from '../../framework/heist.js';
import { generateGroups, generateSubs } from '../../subcommands/fun/generate.js';

export default hgroup({ name: 'generate', scope: 'anywhere', subs: generateSubs, groups: generateGroups });
