import { AttachmentBuilder, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, TextDisplayBuilder, type Guild } from 'discord.js';
import type { Sub } from '../../framework/group.js';
import { db, getActiveBoost } from '../../utils/db.js';
import { IS_CV2 } from '../../utils/components.js';
import { randInt } from '../../utils/random.js';
import { adjustBalance } from '../../utils/db.js';
import {
  TRANSFER_TAX, claimCooldown, claimOnce, fmtDuration, getEco, getHistory, getWealthSeries, leaderboard, transferFromBank, type LbRow,
} from '../../eco/core.js';
import { BONUS } from '../../eco/catalog.js';
import { careerMultiplier } from '../../eco/effects.js';
import { renderWealthGraph } from '../../eco/render.js';
import { AMOUNT_HELP, Colors, cv2Box, cv2Err, ecoCtx, parseAmount, short } from './ui.js';
import { getWalletStyle } from './wallet.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ─── transfer ────────────────────────────────────────────────────────────────

export const transfer: Sub = {
  name: 'transfer',
  description: `Send banked money to another user (${TRANSFER_TAX * 100}% tax)`,
  options: s => s
    .addUserOption(o => o.setName('user').setDescription('Who to send it to').setRequired(true))
    .addStringOption(o => o.setName('amount').setDescription(`From your bank — ${AMOUNT_HELP}`).setRequired(true)),
  async run(i) {
    const ctx = await ecoCtx(i);
    const target = i.options.getUser('user', true);
    if (target.bot) { await i.reply(cv2Err('You can\'t send money to a bot.')); return; }
    const eco = await getEco(ctx.guildId, ctx.userId);
    const amount = parseAmount(i.options.getString('amount', true), eco.bank);
    if (!amount) { await i.reply(cv2Err(`I couldn't read that amount. You have ${ctx.fmt(eco.bank)} in the bank (transfers come out of the bank).`)); return; }
    const r = await transferFromBank(ctx.guildId, ctx.userId, target.id, amount);
    if (!r.ok) {
      await i.reply(cv2Err(r.reason === 'self' ? 'You can\'t send money to yourself.' : `❌ You don't have ${ctx.fmt(amount)} in your bank. Deposit first with \`/eco bank deposit\`.`));
      return;
    }
    await i.reply(cv2Box(
      `💸 **Transfer sent**\n<@${ctx.userId}> → <@${target.id}>\nSent **${ctx.fmt(r.sent)}** · tax **${ctx.fmt(r.tax)}** (${TRANSFER_TAX * 100}%) · they receive **${ctx.fmt(r.received)}** in cash.`,
      Colors.Green));
  },
};

// ─── cooldowns ───────────────────────────────────────────────────────────────

const CD_LIST: { key: string; label: string; ms: number }[] = [
  { key: 'daily', label: 'Daily', ms: 20 * HOUR },
  { key: 'weekly', label: 'Weekly', ms: 7 * DAY },
  { key: 'monthly', label: 'Monthly', ms: 30 * DAY },
  { key: 'yearly', label: 'Yearly', ms: 365 * DAY },
  { key: 'work', label: 'Work', ms: HOUR },
  { key: 'beg', label: 'Beg', ms: 15 * 60_000 },
  { key: 'hustle', label: 'Hustle', ms: 30 * 60_000 },
  { key: 'bonus', label: 'Bonus', ms: BONUS.cooldownMs },
  { key: 'rob_success', label: 'Rob (after a win)', ms: HOUR },
  { key: 'rob_fail', label: 'Rob (after a fail)', ms: 30 * 60_000 },
];

export const cooldowns: Sub = {
  name: 'cooldowns',
  description: 'See what you can and can\'t claim right now',
  async run(i) {
    const ctx = await ecoCtx(i);
    const rows = await db`SELECT type, last_used FROM economy_cooldowns WHERE user_id = ${ctx.userId}`;
    const last = new Map((rows as { type: string; last_used: number }[]).map(r => [r.type, r.last_used]));
    const overtime = await getActiveBoost(ctx.guildId, ctx.userId, 'workcd');
    const now = Date.now();
    const lines = CD_LIST.map(c => {
      const ms = c.key === 'work' && overtime ? c.ms / 2 : c.ms;
      const rem = ms - (now - (last.get(c.key) ?? 0));
      const hide = c.key.startsWith('rob_') && rem <= 0;
      if (hide) return null;
      return rem > 0 ? `⏳ **${c.label}** — ready ${`<t:${Math.floor((now + rem) / 1000)}:R>`} *(${fmtDuration(rem)})*` : `✅ **${c.label}** — ready`;
    }).filter(Boolean);
    const [inv] = await db`SELECT ends_at FROM eco_investment WHERE user_id = ${ctx.userId}`;
    const [q] = await db`SELECT ends_at FROM eco_quest WHERE user_id = ${ctx.userId}`;
    if (inv) lines.push(inv.ends_at > now ? `📈 **Investment** — matures <t:${Math.floor(inv.ends_at / 1000)}:R>` : '📈 **Investment** — ✅ ready to complete');
    if (q) lines.push(q.ends_at > now ? `🗺️ **Quest** — done <t:${Math.floor(q.ends_at / 1000)}:R>` : '🗺️ **Quest** — ✅ ready to complete');
    await i.reply(cv2Box(`⏱️ **Your cooldowns**\n${lines.join('\n')}`, Colors.Blurple));
  },
};

// ─── history / graph ─────────────────────────────────────────────────────────

const USER_OPT = (s: import('discord.js').SlashCommandSubcommandBuilder) => s.addUserOption(o => o.setName('user').setDescription('Another user to inspect; defaults to you'));

/** Whose data to show. Someone who hid their wallet (`/eco wallet-edit privacy`) is private to everyone else. */
async function inspect(i: import('discord.js').ChatInputCommandInteraction): Promise<import('discord.js').User | null> {
  const target = i.options.getUser('user') ?? i.user;
  if (target.bot) { await i.reply(cv2Err("Bots don't have wallets.")); return null; }
  if (target.id !== i.user.id && (await getWalletStyle(target.id)).hideWallet) { await i.reply(cv2Err('🔒 That person keeps their wallet private.')); return null; }
  return target;
}

export const history: Sub = {
  name: 'history',
  description: 'Show your recent economy transactions',
  options: USER_OPT,
  async run(i) {
    const ctx = await ecoCtx(i);
    const target = await inspect(i); if (!target) return;
    const rows = await getHistory(target.id, 15);
    if (!rows.length) { await i.reply(cv2Box(target.id === ctx.userId ? 'No transactions yet — try `/eco daily`!' : 'No transactions yet.', Colors.Blurple)); return; }
    const lines = rows.map(r => {
      const sign = r.delta >= 0 ? '🟢 +' : '🔴 ';
      const where = r.where === 'bank' ? '🏦' : '👛';
      return `${sign}${ctx.fmt(Math.abs(r.delta))} ${where} \`${r.reason}\` <t:${Math.floor(r.ts / 1000)}:R>`;
    });
    const who = target.id === ctx.userId ? '' : ` — ${target.displayName ?? target.username}`;
    await i.reply({ ...cv2Box(`🧾 **Recent transactions${who}**\n${lines.join('\n')}`, Colors.Blurple), allowedMentions: { parse: [] } });
  },
};

export const graph: Sub = {
  name: 'graph',
  description: 'Show your balance graph for the last seven days',
  options: USER_OPT,
  async run(i) {
    const ctx = await ecoCtx(i);
    const target = await inspect(i); if (!target) return;
    await i.deferReply();
    const series = await getWealthSeries(ctx.guildId, target.id, 7);
    const png = await renderWealthGraph({ title: `${target.displayName ?? target.username}'s balance — last 7 days`, series, symbol: ctx.sym });
    const container = new ContainerBuilder().setAccentColor(Colors.Blue)
      .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://graph.png')));
    await i.editReply({ flags: IS_CV2, files: [new AttachmentBuilder(png, { name: 'graph.png' })], components: [container] });
  },
};

// ─── guide ───────────────────────────────────────────────────────────────────

export const guide: Sub = {
  name: 'guide',
  description: 'Learn how the economy works',
  async run(i) {
    const ctx = await ecoCtx(i);
    const container = new ContainerBuilder().setAccentColor(Colors.Gold)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## ${ctx.sym} How the economy works\n` +
        `**Earning** — \`/eco daily\` \`monthly\` \`work\` \`hustle\` \`beg\` \`bonus\` \`joinbonus\`, \`/community weekly\` \`yearly\`, plus quests, businesses, labs and investments.\n` +
        `**Cash vs bank** — cash can be **robbed** (\`/eco rob\`). Move it to the bank with \`/eco bank deposit\` to keep it safe. The bank has limited space (\`/eco bank upgrade\`).\n` +
        `**Sending money** — \`/eco transfer\` moves *banked* money to someone else. ${TRANSFER_TAX * 100}% is taxed.\n` +
        `**Growing** — \`/eco business\` (passive income), \`/eco lab\` (needs ampoules), \`/eco investment\` (risk vs reward), \`/eco quest\` (timers).\n` +
        `**Cards** — open cases with \`/eco card buy\` + \`open\`, equip one card per category for small bonuses, merge 10 → 1 with \`/eco card upgrade\`.\n` +
        `**Companies** — team up with \`/eco-company\`: shared vault, projects, leaderboards.\n` +
        `**Gambling** — \`/eco games …\` (slots, blackjack, mines, towers…). Your stake is taken up front. \`/eco games odds\` explains each game.\n` +
        `**Tracking** — \`/eco wallet\`, \`history\`, \`graph\`, \`cooldowns\`, \`leaderboard\`. Style your card with \`/eco wallet-edit\`. Server owners can run economy giveaways with \`/eco giveaway\`.`,
      ));
    await i.reply({ flags: IS_CV2, components: [container] });
  },
};

// ─── bonus ───────────────────────────────────────────────────────────────────

const BONUS_FLAVOR = [
  'You found a wallet on the sidewalk (you kept the cash).', 'A pigeon dropped a coin at your feet.',
  'Your aunt sent you money in a birthday card. It isn\'t your birthday.', 'You won a small raffle at the laundromat.',
  'A vending machine gave you double change.', 'You sold a rock. Somehow.', 'Your old jacket had cash in the pocket.',
];

export const bonus: Sub = {
  name: 'bonus',
  description: 'Claim a random bonus reward (every 6 hours)',
  async run(i) {
    const ctx = await ecoCtx(i);
    const claim = await claimCooldown(ctx.userId, 'bonus', BONUS.cooldownMs);
    if (!claim.ok) { await i.reply(cv2Err(`Your bonus isn't ready. Come back in **${fmtDuration(claim.remainingMs)}**.`)); return; }
    const career = await careerMultiplier(ctx.userId);
    const amount = Math.floor(randInt(BONUS.min, BONUS.max) * career);
    const { newBalance } = await adjustBalance(ctx.guildId, ctx.userId, amount, 'bonus');
    await i.reply(cv2Box(`🎁 **Bonus!**\n${BONUS_FLAVOR[randInt(0, BONUS_FLAVOR.length - 1)]}\nYou got **${ctx.fmt(amount)}**.\nNew balance: **${newBalance.toLocaleString()}**`, Colors.Green));
  },
};

// ─── joinbonus ───────────────────────────────────────────────────────────────

export const joinbonus: Sub = {
  name: 'joinbonus',
  description: 'Claim a one-time cash bonus for joining our server',
  async run(i) {
    const ctx = await ecoCtx(i);
    const supportId = Bun.env.SUPPORT_GUILD_ID;
    if (!supportId) { await i.reply(cv2Err("This bot has no support server set up, so there's no join bonus.")); return; }
    await i.deferReply();
    const member = await i.client.guilds.fetch(supportId).then(g => g.members.fetch(ctx.userId)).catch(() => null);
    if (!member) {
      const invite = Bun.env.SUPPORT_INVITE;
      await i.editReply(cv2Err(`Join our support server first${invite ? ` — ${invite}` : ''} — then run this again to claim **${ctx.fmt(BONUS.joinBonus)}**.`));
      return;
    }
    if (!(await claimOnce(ctx.userId, 'join'))) { await i.editReply(cv2Err('You already claimed your join bonus.')); return; }
    const { newBalance } = await adjustBalance(ctx.guildId, ctx.userId, BONUS.joinBonus, 'joinbonus');
    await i.editReply(cv2Box(`🎉 **Welcome!**\nThanks for joining — here's **${ctx.fmt(BONUS.joinBonus)}**.\nNew balance: **${newBalance.toLocaleString()}**`, Colors.Green));
  },
};

// ─── notifications ───────────────────────────────────────────────────────────

export const notifications: Sub = {
  name: 'toggle-notifications',
  description: 'Toggle DMs when someone robs you',
  async run(i) {
    const ctx = await ecoCtx(i);
    const eco = await getEco(ctx.guildId, ctx.userId);
    const next = eco.notify_rob ? 0 : 1;
    await db`UPDATE economy SET notify_rob = ${next} WHERE user_id = ${ctx.userId}`;
    await i.reply(cv2Box(next ? "🔔 You'll get a DM when someone robs you, and a ping when your work cooldown is up." : '🔕 Rob DMs and work-cooldown pings are now off.', Colors.Blurple));
  },
};

// ─── leaderboards ────────────────────────────────────────────────────────────

async function memberIds(guild: Guild): Promise<string[]> {
  let members = guild.members.cache;
  if (members.size <= 1) members = await guild.members.fetch();
  return [...members.filter(m => !m.user.bot).keys()];
}

async function renderLb(i: import('discord.js').ChatInputCommandInteraction, kind: 'cash' | 'networth', requested: 'server' | 'global') {
  await i.deferReply();
  const ctx = await ecoCtx(i);
  // Outside a server (DM, group DM, or a server where the bot isn't installed) there is no member list, so the board is global.
  const scope = requested === 'server' && i.guild ? 'server' : 'global';
  const rows: LbRow[] = await leaderboard(kind, scope === 'server' ? await memberIds(i.guild!) : null, 10);
  if (!rows.length) { await i.editReply(cv2Box('Nobody has any money yet. Start with `/eco daily`!', Colors.Blurple)); return; }
  const medals = ['🥇', '🥈', '🥉'];
  // Global boards span servers, so show plain usernames (a mention would render as a raw ID for strangers).
  const names = scope === 'global'
    ? await Promise.all(rows.map(async r => (await i.client.users.fetch(r.user_id).catch(() => null))?.username ?? 'Unknown user'))
    : null;
  const lines = rows.map((r, n) => `${medals[n] ?? `**${n + 1}.**`} ${names ? `**${names[n]}**` : `<@${r.user_id}>`} — ${ctx.sym} **${short(r.value)}**`);
  const title = `${kind === 'cash' ? 'Cash' : 'Net worth'} leaderboard — ${scope === 'server' ? (i.guild?.name ?? "this server") : 'global'}`;
  await i.editReply(cv2Box(`🏆 **${title}**\n\n${lines.join('\n')}`, Colors.Gold));
}

export const leaderboardSubs: Sub[] = [
  { name: 'cash', description: 'Cash-only leaderboard for this server', run: i => renderLb(i, 'cash', 'server') },
  { name: 'networth', description: 'Net-worth leaderboard (cash + bank + lab + business)', run: i => renderLb(i, 'networth', 'server') },
  { name: 'global', description: 'Global net-worth leaderboard across every server', run: i => renderLb(i, 'networth', 'global') },
];
