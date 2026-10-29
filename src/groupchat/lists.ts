import {
  ActionRowBuilder, ButtonStyle, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, escapeMarkdown,
  type AutocompleteInteraction, type ChatInputCommandInteraction,
} from 'discord.js';
import { onComponent } from '../framework/router.js';
import { withLock } from '../framework/mutex.js';
import { trunc } from '../lookups/card.js';
import { cv2Err } from '../utils/components.js';
import { button, oops, panel, repaint, row } from './panel.js';
import { scopeOf } from './scope.js';
import * as store from './store.js';

/**
 * /community list: a shared checklist for the chat — groceries, movies to watch, things to pack. Anyone in the chat can add to it
 * (➕ Add opens a pop-up, one item per line), tick things off from the menu on the panel, and clear the ticked ones.
 */

const BLUE = 0x3498db;
const GREY = 0x99aab5;
/** Room the item lines may take in the panel. */
const BODY_BUDGET = 3200;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function listPanel(list: store.List): Promise<any> {
  const items = await store.listItems(list.id);
  const done = items.filter(x => x.done).length;
  const lines: string[] = [];
  let used = 0;
  for (const x of items) {
    const text = escapeMarkdown(trunc(x.text, 120));
    const line = x.done ? `✅ ~~${text}~~` : `⬜ ${text}`;
    if (used + line.length > BODY_BUDGET) { lines.push(`…and ${items.length - lines.length} more`); break; }
    lines.push(line); used += line.length + 1;
  }
  const rows = [];
  if (items.length) {
    // Unticked first, so the things still to do are always in the menu.
    const options = [...items].sort((a, b) => a.done - b.done || a.id - b.id).slice(0, 25)
      .map(x => ({ label: trunc(x.text, 100), value: String(x.id), emoji: x.done ? '✅' : '⬜', ...(x.done ? { description: 'Ticked: choose it to untick' } : {}) }));
    rows.push(row(new StringSelectMenuBuilder().setCustomId(`gc:list:${list.id}:tick`).setPlaceholder('Tick or untick items…').setMinValues(1).setMaxValues(options.length).addOptions(options)));
  }
  rows.push(row(
    button(`gc:list:${list.id}:add`, 'Add', ButtonStyle.Primary, '➕'),
    items.length
      ? button(`gc:list:${list.id}:clear`, 'Clear ticked', ButtonStyle.Secondary, '🧹').setDisabled(!done)
      : button(`gc:list:${list.id}:clear`, 'Delete list', ButtonStyle.Danger, '🗑️'),
    button(`gc:list:${list.id}:refresh`, 'Refresh', ButtonStyle.Secondary, '🔄'),
  ));
  return panel({
    title: `📝 ${escapeMarkdown(list.name)}`,
    body: lines.length ? lines.join('\n') : 'Nothing on it yet. Press **➕ Add** to put something on.',
    footer: `${items.length}/${store.MAX_ITEMS} items · ${done} ticked · anyone here can add and tick`,
    color: BLUE,
    rows,
  });
}

const addModal = (list: store.List) => new ModalBuilder().setCustomId(`gc:list:${list.id}:modal`).setTitle(trunc(`Add to ${list.name}`, 45)).addComponents(
  new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('items').setLabel('One item per line')
    .setPlaceholder('Milk\nEggs\nBread').setStyle(TextInputStyle.Paragraph).setMaxLength(2000).setRequired(true)),
);

export async function runList(i: ChatInputCommandInteraction): Promise<void> {
  let list: store.List;
  try {
    list = await withLock(`gclists:${scopeOf(i)}`, () => store.openList(scopeOf(i), i.options.getString('name') ?? 'List', i.user.id));
  } catch (e) {
    if (!(e instanceof store.GroupError)) throw e;
    await i.reply(cv2Err(`❌ ${e.message}`));
    return;
  }
  await i.reply(await listPanel(list));
}

export async function listAutocomplete(i: AutocompleteInteraction): Promise<void> {
  const q = String(i.options.getFocused()).toLowerCase();
  const lists = await store.chatLists(scopeOf(i));
  await i.respond(lists.filter(l => l.name.toLowerCase().includes(q)).slice(0, 25)
    .map(l => ({ name: trunc(`${l.name} (${l.open} to do, ${l.items} total)`, 100), value: l.name })));
}

onComponent('gc:list:', async i => {
  const [, , rawId, action] = i.customId.split(':');
  const list = await store.getList(Number(rawId));
  if (!list) {
    if (i.isModalSubmit() && !i.isFromMessage()) return oops(i, 'That list was deleted.');
    await repaint(i, panel({ title: '📝 List deleted', body: 'This list was deleted. Start a new one with `/community list`.', color: GREY }));
    return;
  }
  if (list.scope_id !== scopeOf(i)) return oops(i, 'That list belongs to another chat.');

  if (action === 'add' && i.isButton()) { await i.showModal(addModal(list)); return; }
  await withLock(`gclist:${list.id}`, async () => {
    if (action === 'modal' && i.isModalSubmit()) {
      try { await store.addItems(list.id, i.fields.getTextInputValue('items'), i.user.id); } catch (e) {
        if (e instanceof store.GroupError) return oops(i, e.message);
        throw e;
      }
    } else if (action === 'tick' && i.isStringSelectMenu()) {
      await store.toggleItems(list.id, i.values.map(Number));
    } else if (action === 'clear') {
      const r = await store.clearDone(list.id);
      if (r.deletedList) {
        await repaint(i, panel({ title: `📝 ~~${escapeMarkdown(list.name)}~~`, body: `Deleted by <@${i.user.id}>.`, color: GREY }));
        return;
      }
    } else if (action !== 'refresh') return;
    await repaint(i, await listPanel(list));
  });
});
