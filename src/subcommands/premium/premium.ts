import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, TextDisplayBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Sub, SubGroup } from '../../framework/group.js';
import { freeLimit } from '../../ai/limits.js';
import { extendPremium, giftDays, giftSku, isOwner, listGifts, premiumConfigured, premiumOf, premiumSku, redeemGift, revokePremium, type PremiumStatus } from '../../premium/index.js';

const COLOR = 0xf1c40f;
const EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const ts = (ms: number) => `<t:${Math.floor(ms / 1000)}:R>`;
const when = (s: PremiumStatus) => (s.source === 'owner' ? 'as a bot owner' : s.expiresAt ? `until ${ts(s.expiresAt)}` : 'while your subscription is active');

export const perks = () => [
  `**Unlimited AI** — free accounts get ${freeLimitText()} AI requests per hour (\`/ai …\` and @mention chat); Premium removes the limit.`,
  'More perks will be added here as they ship — Premium never locks away anything that is free today.',
];
function freeLimitText() { return freeLimit() || 'unlimited'; }

function box(lines: string[], button?: { label: string; sku: string }) {
  const c = new ContainerBuilder().setAccentColor(COLOR).addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  if (button) c.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Premium).setSKUId(button.sku)));
  return { flags: EPHEMERAL, components: [c], allowedMentions: { parse: [] as never[] } };
}

/** Text + (if purchasable) Discord's own purchase button. The payment itself is handled entirely by Discord. */
export async function perksView(i: ChatInputCommandInteraction) {
  const st = await premiumOf(i);
  const lines = [`## ✨ Bestow Premium`, ...perks().map(p => `• ${p}`)];
  if (st.premium) return box([...lines, '', `✅ **You have Premium** ${when(st)}.`]);
  if (!premiumConfigured()) return box([...lines, '', '*Premium isn\'t on sale yet.*']);
  return box([...lines, '', 'Buy it right here — Discord handles the payment, and it works on every server and DM you use Bestow in.'], { label: 'Get Premium', sku: premiumSku()! });
}

const ownerOnly = (i: ChatInputCommandInteraction) => (isOwner(i.user.id) ? null : i.reply({ ...box(['❌ Only the bot owner can do that.']) }));

export const premiumSubs: Sub[] = [
  { name: 'perks', description: 'Discover what Bestow Premium gives you', run: async i => { await i.reply(await perksView(i)); } },
  {
    name: 'buy', description: 'Get Bestow Premium',
    run: async i => {
      const st = await premiumOf(i);
      if (st.premium) { await i.reply(box([`✅ **You already have Premium** ${when(st)}.`, 'Want to treat a friend? See `/premium gifts buy`.'])); return; }
      if (!premiumConfigured()) { await i.reply(box(['## ✨ Bestow Premium', 'Premium isn\'t on sale yet — check back soon.'])); return; }
      await i.reply(box(['## ✨ Bestow Premium', ...perks().map(p => `• ${p}`), '', 'Press the button to subscribe. Discord handles the payment.'], { label: 'Get Premium', sku: premiumSku()! }));
    },
  },
  {
    name: 'syncrole', description: 'Give yourself the Premium role in the support server',
    run: async i => {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const st = await premiumOf(i);
      const guildId = Bun.env.SUPPORT_GUILD_ID, roleId = Bun.env.PREMIUM_ROLE_ID;
      if (!guildId || !roleId) { await i.editReply('There\'s no support-server Premium role configured on this bot.'); return; }
      if (!st.premium) { await i.editReply('You need Premium first — see `/premium buy`.'); return; }
      try {
        const guild = await i.client.guilds.fetch(guildId);
        const member = await guild.members.fetch(i.user.id);
        await member.roles.add(roleId);
        await i.editReply('✅ Your Premium role has been applied in the support server.');
      } catch { await i.editReply('I couldn\'t apply the role — are you in the support server, and can I manage that role?'); }
    },
  },
  {
    name: 'grant', description: 'Owner: give someone Premium for a number of days',
    options: s => s.addUserOption(o => o.setName('user').setDescription('Who').setRequired(true)).addIntegerOption(o => o.setName('days').setDescription('How many days (default 30)').setMinValue(1).setMaxValue(3650)),
    run: async i => {
      const no = ownerOnly(i); if (no) { await no; return; }
      const u = i.options.getUser('user', true), days = i.options.getInteger('days') ?? 30;
      const exp = await extendPremium(u.id, days, 'grant');
      await i.reply(box([`✅ Granted **${days} day${days === 1 ? '' : 's'}** of Premium to <@${u.id}> (${Number.isFinite(exp) ? `until ${ts(exp)}` : 'they already have a subscription'}).`]));
    },
  },
  {
    name: 'revoke', description: 'Owner: remove someone\'s Premium record',
    options: s => s.addUserOption(o => o.setName('user').setDescription('Who').setRequired(true)),
    run: async i => {
      const no = ownerOnly(i); if (no) { await no; return; }
      const u = i.options.getUser('user', true);
      await i.reply(box([(await revokePremium(u.id)) ? `✅ Removed Premium from <@${u.id}>. (A paid Discord subscription, if they have one, stays valid.)` : `<@${u.id}> had no Premium record.`]));
    },
  },
];

export const giftSubs: Sub[] = [
  {
    name: 'buy', description: 'Buy a Premium gift code for a friend',
    run: async i => {
      const sku = giftSku();
      if (!sku) { await i.reply(box(['## 🎁 Premium gifts', 'Gifts aren\'t on sale yet — check back soon.'])); return; }
      await i.reply(box(['## 🎁 Gift Bestow Premium', `Each gift is a code worth **${giftDays()} days** of Premium. After you buy it, the code arrives in your DMs and in \`/premium gifts inventory\`.`, 'Send the code to a friend — they redeem it with `/premium gifts redeem`.'], { label: 'Buy a gift', sku }));
    },
  },
  {
    name: 'inventory', description: 'See the gift codes you\'ve bought',
    run: async i => {
      const gifts = await listGifts(i.user.id);
      if (!gifts.length) { await i.reply(box(['You haven\'t bought any gifts yet. See `/premium gifts buy`.'])); return; }
      await i.reply(box(['## 🎁 Your gifts', ...gifts.map(g => `\`${g.code}\` — ${g.days} days — ${g.redeemed_by ? `✅ redeemed ${ts(g.redeemed_at!)}` : '🎁 **unredeemed**'}`), '', '-# Only you can see this. Keep unredeemed codes private.']));
    },
  },
  {
    name: 'redeem', description: 'Redeem a Premium gift code',
    options: s => s.addStringOption(o => o.setName('code').setDescription('The code, like BSTW-ABCD-EFGH-JKLM').setRequired(true).setMaxLength(40)),
    run: async i => {
      const r = await redeemGift(i.options.getString('code', true), i.user.id);
      if (r.ok) { await i.reply(box([`🎉 **Premium unlocked!** ${r.days} days added${Number.isFinite(r.expiresAt) ? ` — you have Premium until ${ts(r.expiresAt)}` : ''}.`, 'Enjoy the unlimited AI.'])); return; }
      const why = { invalid: 'That code isn\'t valid. Check it and try again.', used: 'That code has already been redeemed.', own: 'You can\'t redeem a gift you bought yourself — pass it to a friend, or just use `/premium buy`.', active: 'You already have an active Premium subscription, so this gift would be wasted — keep it for a friend.' }[r.reason];
      await i.reply(box([`❌ ${why}`]));
    },
  },
];

export const premiumGroups: SubGroup[] = [{ name: 'gifts', description: 'Gift Premium to your friends', subs: giftSubs }];

