import { hfrom } from '../../framework/heist.js';
import { defineLeaf, pickSub } from '../../framework/group.js';
import { botSubs } from '../../subcommands/info/bot.js';

export default defineLeaf(hfrom('invite', pickSub(botSubs, 'invite')));
