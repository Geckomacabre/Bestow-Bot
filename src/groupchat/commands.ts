import type { Sub, SubGroup } from '../framework/group.js';
import { cv2Err } from '../utils/components.js';
import { timeBoard, whereOf } from './boards.js';
import { listAutocomplete, runList } from './lists.js';
import { runPlan, runPlans } from './plans.js';
import { neverPanel, pickPanel, randomNever, randomWouldYouRather, splitChoices, truthOrDarePanel, wouldYouRatherPanel } from './party.js';
import { MAX_LIST_NAME, MAX_PLAN_DETAILS, MAX_PLAN_TITLE } from './store.js';

/**
 * Things to do together in a chat. Each one is a single command that works the same in a server, a DM or a group chat (a board,
 * plan or list belongs to the chat it was run in), so there's no separate group-chat copy of anything. Everything is a panel run
 * with buttons, because in a group chat Bestow can answer commands and button presses but can't read the chat or post in it on its
 * own. /community mounts the plans, list and party games; /timezone mounts the time board.
 */

/** /timezone everyone */
export const timeBoardSub: Sub = {
  name: 'everyone',
  description: 'Everyone\'s local time in this chat, with a button to add yours',
  run: async i => { await i.reply(await timeBoard(whereOf(i))); },
};

/** /community list */
export const listSub: Sub = {
  name: 'list',
  description: 'A shared list for this chat (shopping, movies, to-dos) that anyone can add to and tick off',
  options: s => s.addStringOption(o => o.setName('name').setDescription('Which list (a new name starts a new one; default "List")').setMaxLength(MAX_LIST_NAME).setAutocomplete(true)),
  run: runList,
  autocomplete: listAutocomplete,
};

/** /community plan … */
export const planGroup: SubGroup = {
  name: 'plan',
  description: 'Plans everyone answers Going / Maybe / Can\'t, in their own timezone',
  subs: [
    {
      name: 'new',
      description: 'Make a plan everyone answers Going / Maybe / Can\'t, shown in each person\'s own timezone',
      options: s => s
        .addStringOption(o => o.setName('title').setDescription('What\'s the plan? e.g. "Movie night"').setRequired(true).setMaxLength(MAX_PLAN_TITLE))
        .addStringOption(o => o.setName('when').setDescription('e.g. "friday 8pm", "tomorrow 19:30", "in 2 hours", "dec 20"').setRequired(true).setMaxLength(60))
        .addStringOption(o => o.setName('details').setDescription('Where, what to bring, a link…').setMaxLength(MAX_PLAN_DETAILS)),
      run: runPlan,
    },
    {
      name: 'list',
      description: 'Upcoming plans in this chat',
      run: runPlans,
    },
  ],
};

/** /community party … */
export const partyGroup: SubGroup = {
  name: 'party',
  description: 'Party games everyone plays with buttons',
  subs: [
    {
      name: 'truthordare',
      description: 'Truth or dare: whoever presses a button has to answer',
      run: async i => { await i.reply(truthOrDarePanel()); },
    },
    {
      name: 'neverhaveiever',
      description: 'Never have I ever: everyone answers with a button',
      run: async i => { await i.reply(await neverPanel(randomNever())); },
    },
    {
      name: 'wouldyourather',
      description: 'Would you rather: everyone votes with a button',
      run: async i => { await i.reply(await wouldYouRatherPanel(randomWouldYouRather())); },
    },
    {
      name: 'pick',
      description: 'Pick at random: where to eat, what to watch, who goes first',
      options: s => s
        .addStringOption(o => o.setName('options').setDescription('Choices separated by commas, e.g. "pizza, sushi, tacos"').setRequired(true).setMaxLength(1000))
        .addIntegerOption(o => o.setName('count').setDescription('How many to pick (default 1)').setMinValue(1).setMaxValue(10)),
      run: async i => {
        const choices = splitChoices(i.options.getString('options', true));
        if (choices.length < 2) { await i.reply(cv2Err('❌ Give me at least two choices, separated by commas: `pizza, sushi, tacos`.')); return; }
        await i.reply(pickPanel(choices, i.options.getInteger('count') ?? 1, i.user.id));
      },
    },
  ],
};
