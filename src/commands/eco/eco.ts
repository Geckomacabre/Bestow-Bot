import { defineGroup, fromCommand, premium } from '../../framework/group.js';
import { claimSubs, hustle } from '../../subcommands/eco/claims.js';
import { rob } from '../../subcommands/eco/rob.js';
import { bankSubs } from '../../subcommands/eco/bank.js';
import { bonus, cooldowns, graph, guide, history, joinbonus, leaderboardSubs, notifications, transfer } from '../../subcommands/eco/misc.js';
import { walletEditSubs, walletView } from '../../subcommands/eco/wallet.js';
import { studioSub } from '../../subcommands/eco/studio.js';
import { ecoGiveawaySub } from '../../subcommands/giveaway/giveaway.js';
import { businessSubs, investmentSubs, labSubs, questSubs } from '../../subcommands/eco/assets.js';
import { cardSubs } from '../../subcommands/eco/cards.js';
import { gameLeaderboardSub, oddsSub, statsSub } from '../../subcommands/eco/games/extras.js';
import { interactiveSubs } from '../../subcommands/eco/games/interactive.js';
import blackjack from '../../subcommands/eco/games/blackjack.js';
import crash from '../../subcommands/eco/games/crash.js';
import flip from '../../subcommands/eco/games/flip.js';
import highroll from '../../subcommands/eco/games/highroll.js';
import jackpot from '../../subcommands/eco/games/jackpot.js';
import plinko from '../../subcommands/eco/games/plinko.js';
import poker from '../../subcommands/eco/games/poker.js';
import roulette from '../../subcommands/eco/games/roulette.js';
import scratch from '../../subcommands/eco/games/scratch.js';
import slots from '../../subcommands/eco/games/slots.js';

// Discord caps a command at 25 direct subcommands/groups: 16 subcommands + 9 groups = 25 (the same tree as Heist's /eco).
// The economy extras that don't fit (weekly, yearly, protection, shop) live under /community.
export default defineGroup({
  name: 'eco',
  description: 'Economy: wallet, bank, games, businesses, cards and more',
  scope: 'anywhere',
  subs: [
    walletView, ...claimSubs, hustle, bonus, joinbonus, rob, transfer, cooldowns, history, graph, guide, notifications, ecoGiveawaySub,
  ],
  groups: [
    { name: 'bank', description: 'Your bank account', subs: bankSubs },
    { name: 'business', description: 'Passive-income businesses', subs: businessSubs },
    { name: 'lab', description: 'Laboratory that turns ampoules into coins', subs: labSubs },
    { name: 'investment', description: 'Risk-versus-reward investments', subs: investmentSubs },
    { name: 'quest', description: 'Timed quests', subs: questSubs },
    { name: 'card', description: 'Trading cards, cases and bonuses', subs: cardSubs },
    { name: 'leaderboard', description: 'Economy leaderboards', subs: leaderboardSubs },
    { name: 'wallet-edit', description: 'Customise your wallet card', subs: premium([...walletEditSubs, studioSub]) },
    {
      name: 'games',
      description: 'Casino games — your stake is taken up front',
      subs: [
        fromCommand(slots), fromCommand(blackjack), fromCommand(roulette), fromCommand(flip, 'coinflip'), fromCommand(highroll),
        fromCommand(crash), fromCommand(poker), fromCommand(scratch), fromCommand(plinko), fromCommand(jackpot),
        ...interactiveSubs, oddsSub, statsSub, gameLeaderboardSub,
      ],
    },
  ],
});
