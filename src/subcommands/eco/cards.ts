import type { Sub } from '../../framework/group.js';
import { askUser } from '../../framework/confirm.js';
import { CARD_CATEGORIES, CASES, MAX_STARS, MERGE_COUNT } from '../../eco/catalog.js';
import {
  buyCases, cardLabel, equipCard, executeCardSale, executeCardTrade, getCard, getCases, listCards, mergeCards, openCases, shredCard,
  shredValue, stars, unequipCategory, type CardRow,
} from '../../eco/cards.js';
import { Colors, cv2Box, cv2Err, ecoCtx } from './ui.js';

const catChoices = Object.entries(CARD_CATEGORIES).map(([value, c]) => ({ name: `${c.emoji} ${c.name}`, value }));
const caseChoices = Object.entries(CASES).map(([value, c]) => ({ name: `${c.emoji} ${c.name}`, value }));
const catLabel = (k: string) => `${CARD_CATEGORIES[k]?.emoji ?? ''} ${CARD_CATEGORIES[k]?.name ?? k}`;
const line = (c: CardRow) => `\`#${c.id}\` ${catLabel(c.category)} — ${cardLabel(c)}${c.equipped ? ' 🟢 *equipped*' : ''}`;

export const cardSubs: Sub[] = [
  {
    name: 'buy', description: 'Buy trading card cases',
    options: s => s
      .addStringOption(o => o.setName('case_type').setDescription('Which case').setRequired(true).addChoices(...caseChoices))
      .addIntegerOption(o => o.setName('amount').setDescription('How many (default 1)').setMinValue(1).setMaxValue(50)),
    async run(i) {
      const ctx = await ecoCtx(i);
      const type = i.options.getString('case_type', true);
      const amount = i.options.getInteger('amount') ?? 1;
      const r = await buyCases(ctx.guildId, ctx.userId, type, amount);
      if (!r.ok) { await i.reply(cv2Err(r.reason === 'funds' ? `❌ ${amount}× ${CASES[type]!.name} costs **${ctx.fmt(r.cost!)}** (you have ${ctx.fmt(r.cash!)}).` : 'Unknown case.')); return; }
      await i.reply(cv2Box(`${r.def.emoji} **Bought ${amount}× ${r.def.name}** for ${ctx.fmt(r.cost)}.\nOpen them with \`/eco card open\`.\nCash: ${ctx.fmt(r.cash)}`, Colors.Green));
    },
  },
  {
    name: 'cases', description: 'View your unopened cases',
    async run(i) {
      const owned = await getCases(i.user.id);
      const rows = Object.entries(owned).map(([k, q]) => `${CASES[k]?.emoji ?? '📦'} **${CASES[k]?.name ?? k}** × ${q}`);
      await i.reply(cv2Box(rows.length ? `📦 **Your cases**\n${rows.join('\n')}` : 'You have no unopened cases. Buy some with `/eco card buy`.', Colors.Blurple));
    },
  },
  {
    name: 'open', description: 'Open trading card cases',
    options: s => s
      .addStringOption(o => o.setName('case_type').setDescription('Which case').setRequired(true).addChoices(...caseChoices))
      .addStringOption(o => o.setName('category').setDescription('Force a category (default: random)').addChoices(...catChoices))
      .addIntegerOption(o => o.setName('amount').setDescription('How many (default 1)').setMinValue(1).setMaxValue(10)),
    async run(i) {
      const type = i.options.getString('case_type', true);
      const r = await openCases(i.user.id, type, i.options.getInteger('amount') ?? 1, i.options.getString('category'));
      if (!r.ok) { await i.reply(cv2Err(r.reason === 'none' ? 'You don\'t have enough of those cases. Buy some with `/eco card buy`.' : 'Unknown case or category.')); return; }
      const best = Math.max(...r.cards.map(c => c.stars));
      await i.reply(cv2Box(`${r.def.emoji} **Opened ${r.cards.length}× ${r.def.name}**\n${r.cards.map(line).join('\n')}\n\n*Equip with \`/eco card equip card_id:\`*`, best >= 4 ? Colors.Gold : Colors.Blurple));
    },
  },
  {
    name: 'list', description: 'List a user\'s trading cards',
    options: s => s
      .addUserOption(o => o.setName('user').setDescription('Whose cards (default: yours)'))
      .addStringOption(o => o.setName('category').setDescription('Only this category').addChoices(...catChoices)),
    async run(i) {
      const target = i.options.getUser('user') ?? i.user;
      const cards = await listCards(target.id, i.options.getString('category'));
      if (!cards.length) { await i.reply(cv2Err(`${target.id === i.user.id ? 'You have' : `${target.username} has`} no cards.`)); return; }
      const shown = cards.slice(0, 25);
      const totals = Object.entries(CARD_CATEGORIES).map(([k, c]) => `${c.emoji} ${cards.filter(x => x.category === k).length}`).join(' · ');
      await i.reply({ ...cv2Box(`🃏 **${target.username}'s cards** (${cards.length})\n${totals}\n\n${shown.map(line).join('\n')}${cards.length > shown.length ? `\n*…and ${cards.length - shown.length} more*` : ''}`, Colors.Blurple), allowedMentions: { parse: [] } });
    },
  },
  {
    name: 'equip', description: 'Equip one of your cards',
    options: s => s.addIntegerOption(o => o.setName('card_id').setDescription('The card\'s #ID').setRequired(true).setMinValue(1)),
    async run(i) {
      const r = await equipCard(i.user.id, i.options.getInteger('card_id', true));
      if (!r.ok) { await i.reply(cv2Err('That isn\'t one of your cards.')); return; }
      const cat = CARD_CATEGORIES[r.card.category]!;
      await i.reply(cv2Box(`🟢 **Equipped** ${cardLabel(r.card)}\n${cat.emoji} ${cat.name}: ${cat.effect}${r.card.standard ? '' : ' *(holo counts double)*'}`, Colors.Green));
    },
  },
  {
    name: 'unequip', description: 'Unequip your active card for a category',
    options: s => s.addStringOption(o => o.setName('category').setDescription('Category').setRequired(true).addChoices(...catChoices)),
    async run(i) {
      const ok = await unequipCategory(i.user.id, i.options.getString('category', true));
      await i.reply(ok ? cv2Box('⚪ Card unequipped.', Colors.Blurple) : cv2Err('You don\'t have a card equipped there.'));
    },
  },
  {
    name: 'shred', description: 'Shred a card for cash',
    options: s => s.addIntegerOption(o => o.setName('card_id').setDescription('The card\'s #ID').setRequired(true).setMinValue(1)),
    async run(i) {
      const ctx = await ecoCtx(i);
      const r = await shredCard(ctx.guildId, ctx.userId, i.options.getInteger('card_id', true));
      if (!r.ok) { await i.reply(cv2Err('That isn\'t one of your cards.')); return; }
      await i.reply(cv2Box(`🗑️ **Shredded** ${cardLabel(r.card)} for **${ctx.fmt(r.value)}**.\nCash: ${ctx.fmt(r.cash)}`, Colors.Orange));
    },
  },
  {
    name: 'upgrade', description: `Merge ${MERGE_COUNT} same-star standard cards into 1 higher-star card`,
    options: s => s
      .addStringOption(o => o.setName('category').setDescription('Category').setRequired(true).addChoices(...catChoices))
      .addIntegerOption(o => o.setName('stars').setDescription('Which star level to merge').setRequired(true).setMinValue(1).setMaxValue(MAX_STARS - 1)),
    async run(i) {
      const r = await mergeCards(i.user.id, i.options.getString('category', true), i.options.getInteger('stars', true));
      if (!r.ok) { await i.reply(cv2Err(r.reason === 'few' ? `You need **${MERGE_COUNT}** standard cards of that star level in that category (you have ${r.have}). Holo cards can't be merged.` : 'That can\'t be merged.')); return; }
      await i.reply(cv2Box(`⬆️ **Merged!** ${MERGE_COUNT} cards became ${line(r.card)}`, Colors.Gold));
    },
  },
  {
    name: 'sell', description: 'Sell a card to another user',
    options: s => s
      .addIntegerOption(o => o.setName('card_id').setDescription('Your card\'s #ID').setRequired(true).setMinValue(1))
      .addUserOption(o => o.setName('user').setDescription('The buyer').setRequired(true))
      .addIntegerOption(o => o.setName('price').setDescription('Price in cash').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000)),
    async run(i) {
      const ctx = await ecoCtx(i);
      const buyer = i.options.getUser('user', true);
      const price = i.options.getInteger('price', true);
      const card = await getCard(i.options.getInteger('card_id', true));
      if (!card || card.owner_id !== i.user.id) { await i.reply(cv2Err('That isn\'t one of your cards.')); return; }
      if (buyer.bot || buyer.id === i.user.id) { await i.reply(cv2Err('Pick another person to sell to.')); return; }
      const ok = await askUser(i, {
        userId: buyer.id, acceptLabel: `Buy for ${price.toLocaleString()}`,
        content: `🃏 <@${buyer.id}>, **${i.user.username}** wants to sell you ${line(card)} for **${ctx.fmt(price)}**. (Sale value if shredded: ${ctx.fmt(shredValue(card))})`,
      });
      if (!ok) { await i.editReply({ content: `❌ ${buyer.username} didn't buy the card.`, components: [] }).catch(() => {}); return; }
      const r = await executeCardSale(i.user.id, buyer.id, card.id, price, ctx.guildId);
      await i.editReply({ content: r.ok ? `✅ **Sold!** <@${buyer.id}> bought ${cardLabel(card)} from <@${i.user.id}> for **${ctx.fmt(price)}**.` : r.reason === 'funds' ? `❌ <@${buyer.id}> doesn't have ${ctx.fmt(price)} in cash.` : '❌ The card is no longer available.', components: [] });
    },
  },
  {
    name: 'trade', description: 'Trade a card 1-for-1 with another user',
    options: s => s
      .addIntegerOption(o => o.setName('your_card_id').setDescription('Your card\'s #ID').setRequired(true).setMinValue(1))
      .addIntegerOption(o => o.setName('their_card_id').setDescription('Their card\'s #ID').setRequired(true).setMinValue(1))
      .addUserOption(o => o.setName('user').setDescription('Who you\'re trading with').setRequired(true)),
    async run(i) {
      const them = i.options.getUser('user', true);
      const mine = await getCard(i.options.getInteger('your_card_id', true));
      const theirs = await getCard(i.options.getInteger('their_card_id', true));
      if (!mine || mine.owner_id !== i.user.id) { await i.reply(cv2Err('Your card ID isn\'t one of your cards.')); return; }
      if (!theirs || theirs.owner_id !== them.id) { await i.reply(cv2Err(`That card isn't owned by ${them.username}.`)); return; }
      if (them.bot || them.id === i.user.id) { await i.reply(cv2Err('Pick another person to trade with.')); return; }
      const ok = await askUser(i, {
        userId: them.id, acceptLabel: 'Accept trade',
        content: `🔄 <@${them.id}>, **${i.user.username}** offers ${line(mine)}\nfor your ${line(theirs)}`,
      });
      if (!ok) { await i.editReply({ content: '❌ Trade declined.', components: [] }).catch(() => {}); return; }
      const r = await executeCardTrade(i.user.id, mine.id, them.id, theirs.id);
      await i.editReply({ content: r.ok ? `✅ **Traded!** <@${i.user.id}> ⇄ <@${them.id}>` : '❌ One of the cards is no longer available.', components: [] });
    },
  },
];

export { stars };
