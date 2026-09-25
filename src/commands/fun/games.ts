import { hfrom, hgroup } from '../../framework/heist.js';
import { gameSubs } from '../../subcommands/games/games.js';

// Heist's order; rps and blackjack are open to whoever presses Join, tictactoe can name an opponent.
export default hgroup({ name: 'games', subs: ['tictactoe', 'rps', 'snake', 'blackjack', 'cookie'].map(n => hfrom(`games ${n}`, gameSubs.find(s => s.name === n)!)) });
