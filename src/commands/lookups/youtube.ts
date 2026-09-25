import { hfrom, hgroup } from '../../framework/heist.js';
import { youtubeSubs } from '../../subcommands/lookups/games.js';

export default hgroup({ name: 'youtube', subs: [hfrom('youtube search', youtubeSubs.find(s => s.name === 'search')!, { tweaks: { query: { maxLength: 120 } } })] });
