import { defineGroup, fromCommand, groupFromCommand } from '../../framework/group.js';
import rank from '../../legacy/levels/rank.js';
import level from '../../legacy/levels/level.js';
import rep from '../../legacy/reputation/rep.js';
import birthday from '../../legacy/birthday/birthday.js';
import reminder from '../../legacy/reminders/reminder.js';
import roles from '../../legacy/roles/roles.js';
import freegames from '../../legacy/fun/freegames.js';
import trivia from '../../legacy/fun/trivia.js';
import tenor from '../../legacy/fun/tenor.js';
import advice from '../../legacy/random/advice.js';
import dadjoke from '../../legacy/random/dadjoke.js';
import topic from '../../legacy/random/topic.js';
import roll from '../../legacy/utility/roll.js';
import weather from '../../legacy/utility/weather.js';
import hint from '../../legacy/mediaguess/hint.js';
import voteskip from '../../legacy/mediaguess/voteskip.js';
import guess from '../../legacy/mediaguess/guess.js';
import { extraClaimSubs } from '../../subcommands/eco/claims.js';
import { protection } from '../../subcommands/eco/protection.js';
import shopCommand from '../../subcommands/eco/shop.js';
import { listSub, partyGroup, planGroup } from '../../groupchat/commands.js';

/**
 * Everyday member-facing extras: levels, reputation, birthdays, reminders, plans, shared lists, party games and jokes. One command
 * for servers, DMs and group chats alike: each part works out where it was run (a birthday list or a plan belongs to the server or
 * chat it's in), and the few that need a server say so.
 */
export default defineGroup({
  name: 'community',
  description: 'Levels, birthdays, plans, lists, party games and more, in servers and group chats',
  scope: 'anywhere',
  subs: [
    fromCommand(rank), fromCommand(roll), fromCommand(weather), fromCommand(trivia), fromCommand(advice), fromCommand(dadjoke),
    fromCommand(topic), fromCommand(tenor, 'gif'), guess, fromCommand(hint), fromCommand(voteskip), listSub,
    ...extraClaimSubs, protection, // economy extras that don't fit under /eco
  ],
  groups: [
    groupFromCommand(shopCommand, 'shop'),
    groupFromCommand(level, 'level'),
    groupFromCommand(rep, 'reputation'),
    groupFromCommand(birthday, 'birthday'),
    groupFromCommand(reminder, 'reminder'),
    groupFromCommand(roles, 'roles'),
    groupFromCommand(freegames, 'freegames'),
    planGroup,
    partyGroup,
  ],
});
