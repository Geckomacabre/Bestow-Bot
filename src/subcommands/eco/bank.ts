import type { Sub } from '../../framework/group.js';
import { BANK_SELL_REFUND, BANK_SPACE_PRICE, BANK_START_CAP, bankDeposit, bankSell, bankUpgrade, bankWithdraw, getEco } from '../../eco/core.js';
import { AMOUNT_HELP, Colors, cv2Box, cv2Err, ecoCtx, parseAmount } from './ui.js';

const amountOpt = (desc: string) => (s: import('discord.js').SlashCommandSubcommandBuilder) =>
  s.addStringOption(o => o.setName('amount').setDescription(`${desc} — ${AMOUNT_HELP}`).setRequired(true));

export const bankSubs: Sub[] = [
  {
    name: 'deposit', description: 'Move cash into your bank (safe from robbers)',
    options: amountOpt('How much to deposit'),
    async run(i) {
      const ctx = await ecoCtx(i);
      const eco = await getEco(ctx.guildId, ctx.userId);
      const amount = parseAmount(i.options.getString('amount', true), eco.balance);
      if (!amount) { await i.reply(cv2Err(`I couldn't read that amount. You hold ${ctx.fmt(eco.balance)} in cash.`)); return; }
      const r = await bankDeposit(ctx.guildId, ctx.userId, amount);
      if (!r.ok) {
        const why = r.reason === 'funds' ? `You only have ${ctx.fmt(r.cash)} in cash.` : `Your bank only has room for **${ctx.fmt(Math.max(0, r.bankCap - r.bank))}** more (${r.bank.toLocaleString()}/${r.bankCap.toLocaleString()}). Buy space with \`/eco bank upgrade\`.`;
        await i.reply(cv2Err(`❌ ${why}`)); return;
      }
      await i.reply(cv2Box(`🏦 **Deposited ${ctx.fmt(amount)}**\nCash: **${ctx.fmt(r.cash)}**\nBank: **${ctx.fmt(r.bank)}** / ${r.bankCap.toLocaleString()}`, Colors.Green));
    },
  },
  {
    name: 'withdraw', description: 'Move money from your bank to your cash',
    options: amountOpt('How much to withdraw'),
    async run(i) {
      const ctx = await ecoCtx(i);
      const eco = await getEco(ctx.guildId, ctx.userId);
      const amount = parseAmount(i.options.getString('amount', true), eco.bank);
      if (!amount) { await i.reply(cv2Err(`I couldn't read that amount. You have ${ctx.fmt(eco.bank)} in the bank.`)); return; }
      const r = await bankWithdraw(ctx.guildId, ctx.userId, amount);
      if (!r.ok) { await i.reply(cv2Err(`❌ You only have ${ctx.fmt(r.bank)} in the bank.`)); return; }
      await i.reply(cv2Box(`🏦 **Withdrew ${ctx.fmt(amount)}**\nCash: **${ctx.fmt(r.cash)}** *(can be robbed!)*\nBank: **${ctx.fmt(r.bank)}**`, Colors.Blue));
    },
  },
  {
    name: 'upgrade', description: `Buy more bank space (${BANK_SPACE_PRICE} per space)`,
    options: s => s.addIntegerOption(o => o.setName('amount').setDescription('How many spaces to buy').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000)),
    async run(i) {
      const ctx = await ecoCtx(i);
      const spaces = i.options.getInteger('amount', true);
      const r = await bankUpgrade(ctx.guildId, ctx.userId, spaces);
      if (!r.ok) { await i.reply(cv2Err(`❌ ${spaces.toLocaleString()} spaces cost **${ctx.fmt(r.cost)}** and you only have ${ctx.fmt(r.cash)} in cash.`)); return; }
      await i.reply(cv2Box(`🏦 **Bought ${spaces.toLocaleString()} bank space** for ${ctx.fmt(r.cost)}\nCapacity: **${r.bankCap.toLocaleString()}**\nCash: **${ctx.fmt(r.cash)}**`, Colors.Gold));
    },
  },
  {
    name: 'sell', description: `Sell bank space back for ${BANK_SELL_REFUND * 100}% of its price`,
    options: s => s.addIntegerOption(o => o.setName('amount').setDescription('How many spaces to sell').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000)),
    async run(i) {
      const ctx = await ecoCtx(i);
      const spaces = i.options.getInteger('amount', true);
      const r = await bankSell(ctx.guildId, ctx.userId, spaces);
      if (!r.ok) {
        await i.reply(cv2Err(`❌ You can't sell that much: your capacity can't drop below the starting ${BANK_START_CAP.toLocaleString()} or below the ${r.bank.toLocaleString()} you have stored.`)); return;
      }
      await i.reply(cv2Box(`🏦 **Sold ${spaces.toLocaleString()} bank space** for ${ctx.fmt(r.refund)}\nCapacity: **${r.bankCap.toLocaleString()}**`, Colors.Gold));
    },
  },
  {
    name: 'info', description: 'Show your bank balance and capacity',
    async run(i) {
      const ctx = await ecoCtx(i);
      const eco = await getEco(ctx.guildId, ctx.userId);
      const cap = eco.bank_cap;
      const filled = Math.min(20, Math.round((eco.bank / Math.max(1, cap)) * 20));
      await i.reply(cv2Box(
        `🏦 **Your bank**\n\`${'█'.repeat(filled)}${'░'.repeat(20 - filled)}\` ${eco.bank.toLocaleString()} / ${cap.toLocaleString()}\n` +
        `Cash on hand: **${ctx.fmt(eco.balance)}** *(robbable)*` +
        `\n\n\`/eco bank deposit\` · \`withdraw\` · \`upgrade\` · \`sell\``, Colors.Blue));
    },
  },
];
