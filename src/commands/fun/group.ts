import { defineGroup, type Sub } from '../../framework/group.js';
import { birthdayBoard, timeBoard, whereOf } from '../../groupchat/boards.js';
import { listAutocomplete, runList } from '../../groupchat/lists.js';
import { runPlan, runPlans } from '../../groupchat/plans.js';
import { neverPanel, pickPanel, randomNever, randomWouldYouRather, splitChoices, truthOrDarePanel, wouldYouRatherPanel } from '../../groupchat/party.js';
import { MAX_LIST_NAME, MAX_PLAN_DETAILS, MAX_PLAN_TITLE } from '../../groupchat/store.js';
import { cv2Err } from '../../utils/components.js';

/**
 * /group: things to do together in a group chat (or a DM, or a server channel). Everything is a panel run with buttons, because in
 * a group chat Bestow can answer commands and button presses but can't read the chat or post in it on its own.
 */

const subs: Sub[] = [
  {
    name: 'times',
    description: 'Everyone\'s local time in this chat, with a button to add yours',
    run: async i => { await i.reply(await timeBoard(whereOf(i))); },
  },
  {
    name: 'birthdays',
    description: 'Upcoming birthdays in this chat, with a button to add yours',
    run: async i => { await i.reply(await birthdayBoard(whereOf(i))); },
  },
  {
    name: 'plan',
    description: 'Make a plan everyone answers Going / Maybe / Can\'t, shown in each person\'s own timezone',
    options: s => s
      .addStringOption(o => o.setName('title').setDescription('What\'s the plan? e.g. "Movie night"').setRequired(true).setMaxLength(MAX_PLAN_TITLE))
      .addStringOption(o => o.setName('when').setDescription('e.g. "friday 8pm", "tomorrow 19:30", "in 2 hours", "dec 20"').setRequired(true).setMaxLength(60))
      .addStringOption(o => o.setName('details').setDescription('Where, what to bring, a link…').setMaxLength(MAX_PLAN_DETAILS)),
    run: runPlan,
  },
  {
    name: 'plans',
    description: 'Upcoming plans in this chat',
    run: runPlans,
  },
  {
    name: 'list',
    description: 'A shared list for this chat (shopping, movies, to-dos) that anyone can add to and tick off',
    options: s => s.addStringOption(o => o.setName('name').setDescription('Which list (a new name starts a new one; default "List")').setMaxLength(MAX_LIST_NAME).setAutocomplete(true)),
    run: runList,
    autocomplete: listAutocomplete,
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
];

export default defineGroup({
  name: 'group',
  description: 'Group chat tools: plans, shared lists, birthdays, everyone\'s time and party games',
  scope: 'anywhere',
  subs,
});
