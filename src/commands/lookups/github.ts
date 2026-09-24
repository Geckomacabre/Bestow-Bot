import { defineGroup } from '../../framework/group.js';
import { githubSubs } from '../../subcommands/lookups/games.js';

export default defineGroup({ name: 'github', description: 'Look up GitHub repositories and users', subs: githubSubs });
