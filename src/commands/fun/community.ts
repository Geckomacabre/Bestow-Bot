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
import wouldyourather from '../../legacy/random/wouldyourather.js';
import roll from '../../legacy/utility/roll.js';
import weather from '../../legacy/utility/weather.js';
import hint from '../../legacy/mediaguess/hint.js';
import voteskip from '../../legacy/mediaguess/voteskip.js';

/** Everyday member-facing extras: levels, reputation, birthdays, reminders, small games and jokes. */
export default defineGroup({
  name: 'community',
  description: 'Levels, reputation, birthdays, reminders and small extras',
  scope: 'anywhere',
  subs: [
    fromCommand(rank), fromCommand(roll), fromCommand(weather), fromCommand(trivia), fromCommand(advice), fromCommand(dadjoke),
    fromCommand(topic), fromCommand(wouldyourather), fromCommand(tenor, 'gif'), fromCommand(hint), fromCommand(voteskip),
  ],
  groups: [
    groupFromCommand(level, 'level'),
    groupFromCommand(rep, 'reputation'),
    groupFromCommand(birthday, 'birthday'),
    groupFromCommand(reminder, 'reminder'),
    groupFromCommand(roles, 'roles'),
    groupFromCommand(freegames, 'freegames'),
  ],
});
