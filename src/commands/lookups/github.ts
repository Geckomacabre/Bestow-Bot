import { hfrom, hgroup } from '../../framework/heist.js';
import { githubSubs } from '../../subcommands/lookups/games.js';

const old = (n: string) => githubSubs.find(s => s.name === n)!;
// /github 2email is declined (harvests email addresses; see docs/heist-parity.json).
export default hgroup({ name: 'github', subs: [hfrom('github user', old('user'), { tweaks: { username: { maxLength: 39 } } }), hfrom('github repo', old('repo'), { tweaks: { repo: { maxLength: 200 } } })] });
