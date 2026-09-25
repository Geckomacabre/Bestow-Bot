import { defineLeaf, pickSub } from '../../framework/group.js';
import { botSubs } from '../../subcommands/info/bot.js';

export default defineLeaf(pickSub(botSubs, 'invite'));
