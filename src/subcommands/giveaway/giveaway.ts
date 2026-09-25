import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import type { Sub } from '../../framework/group.js';
import { parseDuration, formatDuration } from '../../framework/duration.js';
import { cv2Err } from '../../utils/components.js';
import { card } from '../../lookups/card.js';
import { MAX_DURATION, MAX_WINNERS, MIN_DURATION, attachMessage, cancelGiveaway, createGiveaway, editGiveaway, entryCount, getByMessage, listActive, rerollGiveaway, type CreateResult, type Giveaway } from '../../giveaway/core.js';
import { clientFetch, finishGiveaway, giveawayView } from '../../giveaway/service.js';
import { ecoCtx, parseAmount, AMOUNT_HELP } from '../eco/ui.js';
import { getEco } from '../../eco/core.js';
import { inviteUrl } from '../info/bot.js';

const say = (content: string) => ({ content, flags: MessageFlags.Ephemeral as const });
const MIN_POT = 100;

/**
 * Giveaways must edit their own message hours later, which a user-installed app can't do (its interaction token dies after 15 minutes).
 * So they need Bestow installed in the server itself — this says so instead of failing silently.
 */
async function needServerInstall(i: ChatInputCommandInteraction): Promise<boolean> {
  if (i.guild) return false;
  await i.reply(say(`🎉 Giveaways need Bestow **added to this server** (not just to your account), because it has to update the message when the giveaway ends. Ask a server admin to add it: ${inviteUrl(i.client.user?.id ?? '')}`));
  return true;
}

const messageIdOf = (s: string) => /(\d{15,25})\D*$/.exec(s.trim())?.[1] ?? null;

/** Finds a giveaway in THIS server by message id or link. Never reaches into another server's giveaways. */
async function locate(i: ChatInputCommandInteraction): Promise<Giveaway | null> {
  const id = messageIdOf(i.options.getString('message_id', true));
  const g = id ? await getByMessage(id) : undefined;
  if (!g || g.guild_id !== i.guildId) { await i.reply(say('❌ I couldn\'t find a giveaway with that message ID in this server. Copy the ID (or link) of the giveaway message.')); return null; }
  return g;
}

const REASONS: Record<Exclude<CreateResult, { ok: true }>['reason'], string> = {
  duration: `The duration must be between ${formatDuration(MIN_DURATION)} and ${formatDuration(MAX_DURATION)} — try \`30m\`, \`2h\` or \`1d\`.`,
  winners: `Winners must be between 1 and ${MAX_WINNERS}.`, prize: 'Give the giveaway a prize (up to 200 characters).',
  'too-many': 'This server already has the maximum number of active giveaways.', funds: 'You can\'t afford that prize pool.',
};

async function publish(i: ChatInputCommandInteraction, r: CreateResult): Promise<void> {
  if (!r.ok) { await i.editReply({ ...cv2Err(`❌ ${REASONS[r.reason]}`), flags: MessageFlags.IsComponentsV2 }); return; }
  try {
    const msg = await i.editReply(giveawayView(r.giveaway, 0));
    await attachMessage(r.giveaway.id, msg.id);
  } catch (err) {
    await cancelGiveaway(r.giveaway.id); // couldn't post it: undo (and refund any escrow)
    throw err;
  }
}

const startOptions = (s: import('discord.js').SlashCommandSubcommandBuilder) => s
  .addStringOption(o => o.setName('duration').setDescription('How long it runs, e.g. 30m, 2h, 1d').setRequired(true).setMaxLength(40))
  .addIntegerOption(o => o.setName('winners').setDescription(`How many winners (1–${MAX_WINNERS})`).setRequired(true).setMinValue(1).setMaxValue(MAX_WINNERS));

export const giveawaySubs: Sub[] = [
  {
    name: 'start', description: 'Start a giveaway in this channel', guildOnly: true, permissions: PermissionFlagsBits.ManageGuild,
    options: s => startOptions(s).addStringOption(o => o.setName('prize').setDescription('What you\'re giving away').setRequired(true).setMaxLength(200))
      .addAttachmentOption(o => o.setName('image').setDescription('A picture to show on the giveaway (optional)')),
    run: async i => {
      if (await needServerInstall(i)) return;
      const ms = parseDuration(i.options.getString('duration', true));
      const img = i.options.getAttachment('image');
      await i.deferReply();
      await publish(i, ms == null ? { ok: false, reason: 'duration' } : await createGiveaway({
        guildId: i.guildId!, channelId: i.channelId, hostId: i.user.id, prize: i.options.getString('prize', true), winners: i.options.getInteger('winners', true), durationMs: ms,
        imageUrl: img?.contentType?.startsWith('image/') ? img.url : null,
      }));
    },
  },
  {
    name: 'end', description: 'End a giveaway early and pick the winners', guildOnly: true, permissions: PermissionFlagsBits.ManageGuild,
    options: s => s.addStringOption(o => o.setName('message_id').setDescription('The giveaway message ID or link').setRequired(true)),
    run: async i => {
      if (await needServerInstall(i)) return;
      const g = await locate(i); if (!g) return;
      if (g.status !== 'active') { await i.reply(say(`That giveaway is already ${g.status}.`)); return; }
      await i.reply(say('⏱️ Ending it now…'));
      await finishGiveaway(g.id, clientFetch(i.client));
    },
  },
  {
    name: 'reroll', description: 'Pick new winners for a finished giveaway', guildOnly: true, permissions: PermissionFlagsBits.ManageGuild,
    options: s => s.addStringOption(o => o.setName('message_id').setDescription('The giveaway message ID or link').setRequired(true)).addIntegerOption(o => o.setName('count').setDescription('How many new winners (default: the original number)').setMinValue(1).setMaxValue(MAX_WINNERS)),
    run: async i => {
      if (await needServerInstall(i)) return;
      const g = await locate(i); if (!g) return;
      const r = await rerollGiveaway(g.id, i.options.getInteger('count') ?? undefined);
      if (!r.ok) { await i.reply(say({ missing: 'I can\'t find that giveaway.', active: 'That giveaway is still running — use `/giveaway end` first.', funded: 'That giveaway paid out coins already, so it can\'t be rerolled.', 'no-entries': 'Nobody entered that giveaway.' }[r.reason])); return; }
      await i.reply({ content: `🎉 New winner${r.winners.length === 1 ? '' : 's'} for **${g.prize}**: ${r.winners.map(w => `<@${w}>`).join(', ')}! Congratulations!`, allowedMentions: { users: r.winners } });
    },
  },
  {
    name: 'cancel', description: 'Cancel a giveaway without picking winners', guildOnly: true, permissions: PermissionFlagsBits.ManageGuild,
    options: s => s.addStringOption(o => o.setName('message_id').setDescription('The giveaway message ID or link').setRequired(true)),
    run: async i => {
      if (await needServerInstall(i)) return;
      const g = await locate(i); if (!g) return;
      const done = await cancelGiveaway(g.id);
      if (!done) { await i.reply(say(`That giveaway is already ${g.status}.`)); return; }
      const channel = await clientFetch(i.client)(g.channel_id);
      if (channel && g.message_id) await channel.messages.fetch(g.message_id).then(async m => m.edit(giveawayView({ ...g, status: 'cancelled' }, await entryCount(g.id)))).catch(() => {});
      await i.reply(say(`✅ Cancelled the giveaway for **${g.prize}**${g.pot > 0 ? ' and refunded the prize pool to its host' : ''}.`));
    },
  },
  {
    name: 'edit', description: 'Change an active giveaway\'s prize, winner count or time left', guildOnly: true, permissions: PermissionFlagsBits.ManageGuild,
    options: s => s.addStringOption(o => o.setName('message_id').setDescription('The giveaway message ID or link').setRequired(true))
      .addIntegerOption(o => o.setName('winners').setDescription('New number of winners').setMinValue(1).setMaxValue(MAX_WINNERS))
      .addStringOption(o => o.setName('duration').setDescription('New time left from now, e.g. 2h').setMaxLength(40))
      .addStringOption(o => o.setName('prize').setDescription('New prize').setMaxLength(200)),
    run: async i => {
      if (await needServerInstall(i)) return;
      const g = await locate(i); if (!g) return;
      if (g.pot > 0 && i.options.getString('prize')) { await i.reply(say('Coin giveaways always give away their prize pool, so the prize text can\'t be changed.')); return; }
      const dur = i.options.getString('duration'); const ms = dur ? parseDuration(dur) : null;
      if (dur && (ms == null || ms < MIN_DURATION || ms > MAX_DURATION)) { await i.reply(say(`❌ ${REASONS.duration}`)); return; }
      const updated = await editGiveaway(g.id, { prize: i.options.getString('prize') ?? undefined, winners: i.options.getInteger('winners') ?? undefined, endsAt: ms ? Date.now() + ms : undefined });
      if (!updated) { await i.reply(say(`That giveaway is already ${g.status}.`)); return; }
      const channel = await clientFetch(i.client)(g.channel_id);
      if (channel && g.message_id) await channel.messages.fetch(g.message_id).then(async m => m.edit(giveawayView(updated, await entryCount(g.id)))).catch(() => {});
      await i.reply(say('✅ Giveaway updated.'));
    },
  },
  {
    name: 'list', description: 'List the active giveaways in this server', guildOnly: true,
    run: async i => {
      if (await needServerInstall(i)) return;
      const all = await listActive(i.guildId!);
      const lines = await Promise.all(all.map(async g => `**${g.prize}** — ${g.winners} winner${g.winners === 1 ? '' : 's'}, ${(await entryCount(g.id)).toLocaleString('en-US')} entries, ends <t:${Math.floor(g.ends_at / 1000)}:R> · [jump](https://discord.com/channels/${g.guild_id}/${g.channel_id}/${g.message_id})`));
      await i.reply({ ...card({ title: 'Active giveaways', color: 0xeb459e, description: lines.length ? lines.join('\n') : '*No active giveaways.*' }), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },
  },
];

/** `/eco giveaway`: anyone can fund a giveaway from their own cash; winners split it (25% tax), and it's refunded if nobody enters. */
export const ecoGiveawaySub: Sub = {
  name: 'giveaway', description: `Start a giveaway paid from your cash (${25}% tax on payout)`, guildOnly: true,
  options: s => s.addStringOption(o => o.setName('amount').setDescription(`How much to give away — ${AMOUNT_HELP}`).setRequired(true)).addIntegerOption(o => o.setName('winners').setDescription(`How many winners (1–${MAX_WINNERS})`).setRequired(true).setMinValue(1).setMaxValue(MAX_WINNERS))
    .addStringOption(o => o.setName('duration').setDescription('How long it runs, e.g. 30m, 2h, 1d').setRequired(true).setMaxLength(40)),
  run: async i => {
    if (await needServerInstall(i)) return;
    const ctx = await ecoCtx(i);
    const eco = await getEco(ctx.guildId, ctx.userId);
    const amount = parseAmount(i.options.getString('amount', true), eco.balance);
    if (!amount || amount < MIN_POT) { await i.reply(say(`❌ The smallest pot is ${MIN_POT.toLocaleString('en-US')}. ${AMOUNT_HELP}.`)); return; }
    const ms = parseDuration(i.options.getString('duration', true));
    await i.deferReply();
    await publish(i, ms == null ? { ok: false, reason: 'duration' } : await createGiveaway({
      guildId: ctx.guildId, channelId: i.channelId, hostId: ctx.userId, prize: `${ctx.fmt(amount)} ${ctx.name}`, winners: i.options.getInteger('winners', true), durationMs: ms, pot: amount,
    }));
  },
};

