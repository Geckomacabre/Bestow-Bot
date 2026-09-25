import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, TextDisplayBuilder, type Client } from 'discord.js';
import { hgroup, hsub } from '../../framework/heist.js';
import { onComponent } from '../../framework/router.js';
import { listCard, trunc } from '../../lookups/card.js';
import { cv2Box, cv2Err } from '../../utils/components.js';
import { isOwner } from '../../premium/index.js';
import * as store from '../../profile/store.js';

/**
 * /donate: people who supported the bot submit their donation (name, amount, message). A bot owner approves it (DM or
 * REPORT_CHANNEL_ID) before it shows on the leaderboard, so nobody can just claim a spot. DONATE_URL says where to donate.
 */

const PINK = 0xeb459e;
const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function notifyOwners(client: Client, d: store.Donation) {
  const c = new ContainerBuilder().setAccentColor(PINK)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 💝 Donation #${d.id} to review\n**From:** ${trunc(d.name, 64)} (<@${d.user_id}>)\n**Amount:** ${money(d.amount)}${d.note ? `\n**Message:** ${trunc(d.note, 200)}` : ''}`))
    .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`don:ok:${d.id}`).setStyle(ButtonStyle.Success).setLabel('Approve'),
      new ButtonBuilder().setCustomId(`don:no:${d.id}`).setStyle(ButtonStyle.Danger).setLabel('Reject')));
  const payload = { flags: MessageFlags.IsComponentsV2 as const, components: [c], allowedMentions: { parse: [] as never[] } };
  const channelId = Bun.env.REPORT_CHANNEL_ID;
  if (channelId) {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (ch?.isSendable()) { await ch.send(payload).catch(() => {}); return; }
  }
  for (const id of (Bun.env.OWNER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
    const u = await client.users.fetch(id).catch(() => null);
    await u?.send(payload).catch(() => {});
  }
}

onComponent('don:', async b => {
  if (!b.isButton()) return;
  if (!isOwner(b.user.id)) { await b.reply({ content: 'Only a bot owner can review donations.', flags: MessageFlags.Ephemeral }); return; }
  const [, verb, id] = b.customId.split(':');
  const d = await store.reviewDonation(Number(id), verb === 'ok');
  if (!d) { await b.reply({ content: 'That donation was already reviewed.', flags: MessageFlags.Ephemeral }); return; }
  await b.update({ components: [new ContainerBuilder().setAccentColor(verb === 'ok' ? 0x57f287 : 0xed4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`${verb === 'ok' ? '✅ Approved' : '❌ Rejected'} donation #${d.id}: ${money(d.amount)} from ${trunc(d.name, 64)} (<@${d.user_id}>)`))] });
  const u = await b.client.users.fetch(d.user_id).catch(() => null);
  if (verb === 'ok') await u?.send({ content: `💝 Thank you! Your ${money(d.amount)} donation is now on the /donate leaderboard.` }).catch(() => {});
});

export default hgroup({
  name: 'donate',
  subs: [
    hsub('donate leaderboard', async i => {
      const top = await store.donationLeaderboard(15);
      const url = Bun.env.DONATE_URL;
      await i.reply(listCard('💝 Top donators', top.map((d, n) => `**${n + 1}.** ${trunc(d.name, 40)} (<@${d.user_id}>) — **${money(d.total)}**${d.count > 1 ? ` · ${d.count} donations` : ''}`), {
        color: PINK, footer: top.length ? 'Thank you to everyone who keeps the bot running!' : 'No donations yet — be the first!', links: url ? [{ label: 'Donate', url }] : [],
      }));
    }),
    hsub('donate submit', async i => {
      const amount = i.options.getNumber('amount', true);
      if (!(amount > 0 && amount <= store.MAX_AMOUNT)) { await i.reply(cv2Err(`❌ The amount must be between 0 and ${store.MAX_AMOUNT.toLocaleString('en-US')}.`)); return; }
      const d = await store.submitDonation(i.user.id, i.options.getString('name', true), amount, i.options.getString('message'));
      await notifyOwners(i.client, d);
      await i.reply({ ...cv2Box(`💝 Thanks! Your donation of **${money(d.amount)}** was sent for review. Once a bot owner confirms it, it shows on \`/donate leaderboard\`.`, PINK), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }, { tweaks: { name: { maxLength: 64 }, amount: { min: 0.01, max: store.MAX_AMOUNT }, message: { maxLength: 200 } } }),
  ],
});
