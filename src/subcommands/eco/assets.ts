import type { Sub } from '../../framework/group.js';
import { BUSINESSES, BUSINESS_SELL_REFUND, INVESTMENTS, LAB, MAX_ACCRUAL_HOURS, QUEST_TIERS } from '../../eco/catalog.js';
import {
  businessPending, buyAmpoules, buyBusiness, buyLab, collectBusiness, collectLab, completeInvestment, completeQuest, getBusiness,
  getInvestment, getLab, getQuest, labCapacity, labProducible, labRate, labUpgradeCost, questLeaderboard, sellBusiness, sellLab,
  startInvestment, startQuest, stopQuest, upgradeLab,
} from '../../eco/assets.js';
import { fmtDuration } from '../../eco/core.js';
import { Colors, cv2Box, cv2Err, ecoCtx, short } from './ui.js';
import type { Guild } from 'discord.js';

const choices = <T extends Record<string, { name: string; emoji?: string }>>(o: T) =>
  Object.entries(o).map(([value, d]) => ({ name: `${d.emoji ?? ''} ${d.name}`.trim(), value }));
const ts = (ms: number) => `<t:${Math.floor(ms / 1000)}:R>`;

// ─── Business ────────────────────────────────────────────────────────────────

export const businessSubs: Sub[] = [
  {
    name: 'list', description: 'List available businesses',
    async run(i) {
      const ctx = await ecoCtx(i);
      const lines = Object.entries(BUSINESSES).map(([, b]) =>
        `${b.emoji} **${b.name}** — ${ctx.fmt(b.cost)}\n> ${ctx.sym} ${b.perHour.toLocaleString()}/hour (max ${MAX_ACCRUAL_HOURS}h stored) · ${b.blurb}`);
      await i.reply(cv2Box(`🏢 **Businesses**\nYou can own one at a time. Buy with \`/eco business buy\`.\n\n${lines.join('\n')}`, Colors.Blurple));
    },
  },
  {
    name: 'buy', description: 'Buy a business',
    options: s => s.addStringOption(o => o.setName('name').setDescription('Which business').setRequired(true).addChoices(...choices(BUSINESSES))),
    async run(i) {
      const ctx = await ecoCtx(i);
      const kind = i.options.getString('name', true);
      const r = await buyBusiness(ctx.guildId, ctx.userId, kind);
      if (!r.ok) {
        const msg = r.reason === 'owned' ? 'You already own a business — sell it first with `/eco business sell`.'
          : r.reason === 'funds' ? `You need **${ctx.fmt(BUSINESSES[kind]!.cost)}** in cash (you have ${ctx.fmt(r.cash!)}).` : 'Unknown business.';
        await i.reply(cv2Err(`❌ ${msg}`)); return;
      }
      await i.reply(cv2Box(`${r.def.emoji} **You bought a ${r.def.name}!**\nIt earns **${ctx.fmt(r.def.perHour)}/hour**. Collect with \`/eco business collect\`.\nCash: ${ctx.fmt(r.cash)}`, Colors.Green));
    },
  },
  {
    name: 'collect', description: 'Collect your business earnings',
    async run(i) {
      const ctx = await ecoCtx(i);
      const r = await collectBusiness(ctx.guildId, ctx.userId);
      if (!r.ok) { await i.reply(cv2Err(r.reason === 'none' ? 'You don\'t own a business.' : 'Nothing to collect yet — check back later.')); return; }
      const b = BUSINESSES[r.kind]!;
      await i.reply(cv2Box(`${b.emoji} **Collected ${ctx.fmt(r.amount)}** from your ${b.name}.\nCash: ${ctx.fmt(r.cash)}`, Colors.Green));
    },
  },
  {
    name: 'info', description: 'View a business',
    options: s => s.addUserOption(o => o.setName('user').setDescription('Whose business (default: yours)')),
    async run(i) {
      const ctx = await ecoCtx(i);
      const target = i.options.getUser('user') ?? i.user;
      const biz = await getBusiness(target.id);
      if (!biz) { await i.reply(cv2Err(`${target.id === i.user.id ? 'You don\'t' : `${target.username} doesn't`} own a business.`)); return; }
      const b = BUSINESSES[biz.kind]!;
      const pending = businessPending(biz.kind, biz.last_collected);
      await i.reply(cv2Box(
        `${b.emoji} **${b.name}** — owned by <@${target.id}>\n> ${b.blurb}\nIncome: **${ctx.fmt(b.perHour)}/hour**\nWaiting to collect: **${ctx.fmt(pending)}**\nOpened ${ts(biz.bought_at)}`, Colors.Gold));
    },
  },
  {
    name: 'sell', description: `Sell your business for ${BUSINESS_SELL_REFUND * 100}% of its price (plus pending income)`,
    async run(i) {
      const ctx = await ecoCtx(i);
      const r = await sellBusiness(ctx.guildId, ctx.userId);
      if (!r.ok) { await i.reply(cv2Err('You don\'t own a business.')); return; }
      await i.reply(cv2Box(`💼 **Sold your ${BUSINESSES[r.kind]!.name}** for **${ctx.fmt(r.refund)}** (incl. ${ctx.fmt(r.pending)} pending).\nCash: ${ctx.fmt(r.cash)}`, Colors.Gold));
    },
  },
];

// ─── Lab ─────────────────────────────────────────────────────────────────────

export const labSubs: Sub[] = [
  {
    name: 'buy', description: `Buy a research laboratory (${LAB.buyCost.toLocaleString()})`,
    async run(i) {
      const ctx = await ecoCtx(i);
      const r = await buyLab(ctx.guildId, ctx.userId);
      if (!r.ok) { await i.reply(cv2Err(r.reason === 'owned' ? 'You already own a lab.' : `❌ A lab costs **${ctx.fmt(LAB.buyCost)}** (you have ${ctx.fmt(r.cash!)}).`)); return; }
      await i.reply(cv2Box(`🧪 **Lab built!**\nIt needs **ampoules** to run — buy them with \`/eco lab ampoules\` (${ctx.fmt(LAB.ampoulePrice)} each, 1 per running hour).\nCash: ${ctx.fmt(r.cash)}`, Colors.Green));
    },
  },
  {
    name: 'ampoules', description: `Buy ampoules for your lab (${LAB.ampoulePrice} each)`,
    options: s => s.addIntegerOption(o => o.setName('amount').setDescription('How many').setRequired(true).setMinValue(1).setMaxValue(240)),
    async run(i) {
      const ctx = await ecoCtx(i);
      const amount = i.options.getInteger('amount', true);
      const r = await buyAmpoules(ctx.guildId, ctx.userId, amount);
      if (!r.ok) {
        const msg = r.reason === 'none' ? 'You don\'t own a lab.' : r.reason === 'full' ? `Your lab only has room for **${r.room}** more ampoules (upgrade it to store more).` : `❌ That costs **${ctx.fmt(r.cost!)}** (you have ${ctx.fmt(r.cash!)}).`;
        await i.reply(cv2Err(msg)); return;
      }
      await i.reply(cv2Box(`🧪 **Bought ${amount} ampoules** for ${ctx.fmt(r.cost)}.\nStored: **${r.ampoules}**\nCash: ${ctx.fmt(r.cash)}`, Colors.Green));
    },
  },
  {
    name: 'collect', description: 'Collect your laboratory earnings',
    async run(i) {
      const ctx = await ecoCtx(i);
      const r = await collectLab(ctx.guildId, ctx.userId);
      if (!r.ok) {
        await i.reply(cv2Err(r.reason === 'none' ? 'You don\'t own a lab.' : r.reason === 'no-ampoules' ? 'Your lab is out of ampoules — buy more with `/eco lab ampoules`.' : 'Nothing to collect yet.'));
        return;
      }
      await i.reply(cv2Box(`🧪 **Collected ${ctx.fmt(r.amount)}** (used ${r.used} ampoule${r.used === 1 ? '' : 's'}, ${r.ampoulesLeft} left).\nCash: ${ctx.fmt(r.cash)}`, Colors.Green));
    },
  },
  {
    name: 'info', description: 'View a laboratory',
    options: s => s.addUserOption(o => o.setName('user').setDescription('Whose lab (default: yours)')),
    async run(i) {
      const ctx = await ecoCtx(i);
      const target = i.options.getUser('user') ?? i.user;
      const lab = await getLab(target.id);
      if (!lab) { await i.reply(cv2Err(`${target.id === i.user.id ? 'You don\'t' : `${target.username} doesn't`} own a lab.`)); return; }
      const h = labProducible(lab);
      const nextCost = lab.level < LAB.maxLevel ? `Upgrade: **${ctx.fmt(labUpgradeCost(lab.level))}**` : 'Max level';
      await i.reply(cv2Box(
        `🧪 **Laboratory Lv.${lab.level}** — <@${target.id}>\nProduces **${ctx.fmt(labRate(lab.level))}/hour** while it has ampoules\n` +
        `Ampoules: **${lab.ampoules}/${labCapacity(lab.level)}**\nReady to collect: **${ctx.fmt(Math.floor(h * labRate(lab.level)))}** (${h.toFixed(1)}h)\n${nextCost}`, Colors.Gold));
    },
  },
  {
    name: 'upgrade', description: 'Upgrade your laboratory',
    async run(i) {
      const ctx = await ecoCtx(i);
      const r = await upgradeLab(ctx.guildId, ctx.userId);
      if (!r.ok) {
        await i.reply(cv2Err(r.reason === 'none' ? 'You don\'t own a lab.' : r.reason === 'max' ? 'Your lab is already max level.' : `❌ The upgrade costs **${ctx.fmt(r.cost!)}** (you have ${ctx.fmt(r.cash!)}).`));
        return;
      }
      await i.reply(cv2Box(`🧪 **Lab upgraded to level ${r.level}** for ${ctx.fmt(r.cost)}.\nNow produces **${ctx.fmt(labRate(r.level))}/hour** and stores ${labCapacity(r.level)} ampoules.`, Colors.Gold));
    },
  },
  {
    name: 'sell', description: `Sell your laboratory for ${LAB.sellRefund * 100}% of everything invested`,
    async run(i) {
      const ctx = await ecoCtx(i);
      const r = await sellLab(ctx.guildId, ctx.userId);
      if (!r.ok) { await i.reply(cv2Err('You don\'t own a lab.')); return; }
      await i.reply(cv2Box(`🧪 **Sold your lab** for **${ctx.fmt(r.refund)}**.\nCash: ${ctx.fmt(r.cash)}`, Colors.Gold));
    },
  },
];

// ─── Investments ─────────────────────────────────────────────────────────────

export const investmentSubs: Sub[] = [
  {
    name: 'list', description: 'List all investments that exist',
    async run(i) {
      const ctx = await ecoCtx(i);
      const lines = Object.values(INVESTMENTS).map(d =>
        `${d.emoji} **${d.name}** — ${ctx.fmt(d.cost)} · ${fmtDuration(d.durationMs)}\n> ${Math.round(d.chance * 100)}% to return ×${d.win}${d.lose ? `, otherwise ×${d.lose}` : ', otherwise you lose it all'} · ${d.blurb}`);
      await i.reply(cv2Box(`📈 **Investments**\nOne at a time. Start with \`/eco investment start\`.\n\n${lines.join('\n')}`, Colors.Blurple));
    },
  },
  {
    name: 'start', description: 'Start an investment',
    options: s => s.addStringOption(o => o.setName('name').setDescription('Which investment').setRequired(true).addChoices(...choices(INVESTMENTS))),
    async run(i) {
      const ctx = await ecoCtx(i);
      const kind = i.options.getString('name', true);
      const r = await startInvestment(ctx.guildId, ctx.userId, kind);
      if (!r.ok) {
        await i.reply(cv2Err(r.reason === 'active' ? 'You already have an active investment — `/eco investment status`.' : r.reason === 'funds' ? `❌ That costs **${ctx.fmt(INVESTMENTS[kind]!.cost)}** (you have ${ctx.fmt(r.cash!)}).` : 'Unknown investment.'));
        return;
      }
      await i.reply(cv2Box(`${r.def.emoji} **Invested ${ctx.fmt(r.def.cost)} in ${r.def.name}.**\nIt matures ${ts(r.endsAt)}. Then run \`/eco investment complete\`.`, Colors.Green));
    },
  },
  {
    name: 'status', description: 'View the status of your investment',
    async run(i) {
      const ctx = await ecoCtx(i);
      const inv = await getInvestment(ctx.userId);
      if (!inv) { await i.reply(cv2Err('You have no active investment.')); return; }
      const d = INVESTMENTS[inv.kind]!;
      await i.reply(cv2Box(`${d.emoji} **${d.name}** — ${ctx.fmt(inv.cost)} invested\n${inv.ends_at > Date.now() ? `Matures ${ts(inv.ends_at)}` : '✅ **Ready!** Run `/eco investment complete`.'}`, Colors.Blurple));
    },
  },
  {
    name: 'complete', description: 'Complete your investment',
    async run(i) {
      const ctx = await ecoCtx(i);
      const r = await completeInvestment(ctx.guildId, ctx.userId);
      if (!r.ok) { await i.reply(cv2Err(r.reason === 'pending' ? `Not matured yet — it finishes ${ts(r.endsAt!)}.` : 'You have no investment to complete.')); return; }
      await i.reply(cv2Box(
        r.success ? `${r.def.emoji} 📈 **It paid off!** ${r.def.name} returned **${ctx.fmt(r.payout)}** (+${ctx.fmt(r.payout - r.cost)}).\nCash: ${ctx.fmt(r.cash)}`
          : `${r.def.emoji} 📉 **It flopped.** ${r.def.name} ${r.payout > 0 ? `only returned ${ctx.fmt(r.payout)} of your ${ctx.fmt(r.cost)}` : `lost your whole ${ctx.fmt(r.cost)}`}.\nCash: ${ctx.fmt(r.cash)}`,
        r.success ? Colors.Green : Colors.Red));
    },
  },
];

// ─── Quests ──────────────────────────────────────────────────────────────────

async function memberIds(guild: Guild): Promise<string[]> {
  let members = guild.members.cache;
  if (members.size <= 1) members = await guild.members.fetch();
  return [...members.filter(m => !m.user.bot).keys()];
}

export const questSubs: Sub[] = [
  {
    name: 'start', description: 'Start a quest',
    options: s => s.addStringOption(o => o.setName('difficulty').setDescription('How hard').setRequired(true)
      .addChoices(...Object.entries(QUEST_TIERS).map(([value, t]) => ({ name: `${t.emoji} ${t.label} — ${fmtDuration(t.durationMs)}, ${short(t.min)}–${short(t.max)}`, value })))),
    async run(i) {
      const ctx = await ecoCtx(i);
      const r = await startQuest(ctx.userId, i.options.getString('difficulty', true));
      if (!r.ok) { await i.reply(cv2Err(r.reason === 'active' ? 'You\'re already on a quest — `/eco quest status`.' : 'Unknown difficulty.')); return; }
      await i.reply(cv2Box(`🗺️ **Quest started** (${r.tier.emoji} ${r.tier.label})\n> ${r.title}\nReward: **${ctx.fmt(r.reward)}** · done ${ts(r.endsAt)}`, Colors.Green));
    },
  },
  {
    name: 'status', description: 'View the status of your quest',
    async run(i) {
      const ctx = await ecoCtx(i);
      const q = await getQuest(ctx.userId);
      if (!q) { await i.reply(cv2Err('You\'re not on a quest. Start one with `/eco quest start`.')); return; }
      await i.reply(cv2Box(`🗺️ **${QUEST_TIERS[q.difficulty]?.label} quest**\n> ${q.title}\nReward: **${ctx.fmt(q.reward)}**\n${q.ends_at > Date.now() ? `Done ${ts(q.ends_at)}` : '✅ **Finished!** Run `/eco quest complete`.'}`, Colors.Blurple));
    },
  },
  {
    name: 'complete', description: 'Complete your quest',
    async run(i) {
      const ctx = await ecoCtx(i);
      const r = await completeQuest(ctx.guildId, ctx.userId);
      if (!r.ok) { await i.reply(cv2Err(r.reason === 'pending' ? `Your quest isn't done — it finishes ${ts(r.endsAt!)}.` : 'You\'re not on a quest.')); return; }
      await i.reply(cv2Box(`🏆 **Quest complete!**\n> ${r.quest.title}\nYou earned **${ctx.fmt(r.reward)}**.\nCash: ${ctx.fmt(r.cash)}`, Colors.Gold));
    },
  },
  {
    name: 'stop', description: 'Abandon your quest (no reward)',
    async run(i) {
      const ok = await stopQuest(i.user.id);
      await i.reply(ok ? cv2Box('🏳️ You abandoned your quest.', Colors.Orange) : cv2Err('You\'re not on a quest.'));
    },
  },
  {
    name: 'leaderboard', description: 'View the quest leaderboard for this server',
    async run(i) {
      await i.deferReply();
      const ctx = await ecoCtx(i);
      const rows = await questLeaderboard(await memberIds(i.guild!), 10);
      if (!rows.length) { await i.editReply(cv2Box('Nobody has completed a quest yet.', Colors.Blurple)); return; }
      const medals = ['🥇', '🥈', '🥉'];
      await i.editReply(cv2Box(`🗺️ **Quest leaderboard**\n\n${rows.map((r, n) => `${medals[n] ?? `**${n + 1}.**`} <@${r.user_id}> — **${r.completed}** quests · ${ctx.sym} ${short(r.total_earned)}`).join('\n')}`, Colors.Gold));
    },
  },
];
