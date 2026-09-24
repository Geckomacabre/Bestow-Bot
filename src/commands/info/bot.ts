import { defineGroup } from '../../framework/group.js';
import { botSubs } from '../../subcommands/info/bot.js';

export default defineGroup({ name: 'bot', description: 'About the bot and how to invite it', scope: 'anywhere', subs: botSubs });
