import { ButtonStyle, type ChatInputCommandInteraction } from 'discord.js';
import { onComponent } from '../framework/router.js';
import { trunc } from '../lookups/card.js';
import * as db from '../utils/db.js';
import { cv2Err } from '../utils/components.js';
import { button, oops, panel, privately, row } from './panel.js';
import { botCanPost, placeName, placeOf, scopeOf } from './scope.js';
import * as store from './store.js';
import { parseWhen } from './when.js';

/**
 * /community plan new: "movie night, friday 8pm". The plan is a panel everyone answers with Going / Maybe / Can't. Its time is a Discord
 * timestamp, so each person sees it in their own timezone; the time typed is read in the planner's timezone (/timezone set).
 * 🔔 Remind me sets an ordinary reminder (/community reminder) 15 minutes before; in a group chat it arrives as a DM.
 */

const GREEN = 0x57f287;
const GREY = 0x99aab5;
export const REMIND_BEFORE_MS = 15 * 60_000;

const mentions = (ids: string[]) => (ids.length ? ids.map(u => `<@${u}>`).join(' ') : '');

/** A link to the plan's panel, once it has one. In a DM or group chat the scope is the channel itself. */
export function planLink(p: store.Plan): string | null {
  if (!p.message_id) return null;
  return `https://discord.com/channels/${p.scope_id === p.channel_id ? '@me' : p.scope_id}/${p.channel_id}/${p.message_id}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function planPanel(p: store.Plan, now = Date.now(), confirmingCancel = false): Promise<any> {
  const rsvps = await store.planRsvps(p.id);
  const who = (s: store.RsvpStatus) => rsvps.filter(r => r.status === s).map(r => r.user_id);
  const going = who('going'), maybe = who('maybe'), no = who('no');
  const t = Math.floor(p.starts_at / 1000);
  const over = now > p.starts_at + store.PLAN_GRACE_MS;
  const lines = [`🕒 ${p.all_day ? `<t:${t}:D>` : `<t:${t}:F>`} · <t:${t}:R>`];
  if (p.details) lines.push('', p.details);
  lines.push('', `✅ **Going (${going.length})** ${mentions(going)}`, `🤔 **Maybe (${maybe.length})** ${mentions(maybe)}`, `❌ **Can't (${no.length})** ${mentions(no)}`);
  const rows = over ? [] : confirmingCancel
    ? [row(button(`gc:plan:${p.id}:cancel-yes`, 'Yes, cancel the plan', ButtonStyle.Danger), button(`gc:plan:${p.id}:keep`, 'Keep it', ButtonStyle.Secondary))]
    : [row(
      button(`gc:plan:${p.id}:going`, 'Going', ButtonStyle.Success, '✅'),
      button(`gc:plan:${p.id}:maybe`, 'Maybe', ButtonStyle.Secondary, '🤔'),
      button(`gc:plan:${p.id}:no`, 'Can\'t', ButtonStyle.Secondary, '❌'),
      button(`gc:plan:${p.id}:remind`, 'Remind me', ButtonStyle.Secondary, '🔔'),
      button(`gc:plan:${p.id}:cancel`, 'Cancel', ButtonStyle.Danger),
    )];
  return panel({
    title: `📅 ${p.title}${over ? ' (over)' : ''}`,
    body: lines.join('\n'),
    footer: `${confirmingCancel ? 'Cancel this plan for everyone? · ' : ''}Planned by <@${p.created_by}> · times show in your own timezone`,
    color: over ? GREY : GREEN,
    rows,
  });
}

/** Whether `input` means a different moment depending on the timezone it is read in ("8pm" does, "in 2h" doesn't). */
export const zoneMatters = (input: string): boolean => {
  const now = Date.now();
  return parseWhen(input, 'Etc/GMT+12', now)?.at !== parseWhen(input, 'Etc/GMT-14', now)?.at;
};

export async function runPlan(i: ChatInputCommandInteraction): Promise<void> {
  const raw = i.options.getString('when', true);
  const saved = (await db.getTimezone(i.user.id))?.timezone ?? null;
  const when = parseWhen(raw, saved ?? 'UTC', Date.now(), i.locale !== 'en-US');
  if (!when) {
    await i.reply(cv2Err(`❌ I couldn't read "${trunc(raw, 60)}" as a time. Try \`friday 8pm\`, \`tomorrow 19:30\`, \`sat morning\`, \`in 2 hours\` or \`dec 20\`.`));
    return;
  }
  let plan: store.Plan;
  try {
    plan = await store.createPlan({ scope: scopeOf(i), channelId: i.channelId, title: i.options.getString('title', true), details: i.options.getString('details'), startsAt: when.at, allDay: !when.hasTime, createdBy: i.user.id });
  } catch (e) {
    if (!(e instanceof store.GroupError)) throw e;
    await i.reply(cv2Err(`❌ ${e.message}`));
    return;
  }
  const r = await i.reply({ ...(await planPanel(plan)), withResponse: true });
  const messageId = r?.resource?.message?.id;
  if (messageId) await store.setPlanMessage(plan.id, messageId);
  if (!saved && zoneMatters(raw)) {
    await i.followUp(privately('-# I read that time as UTC because you haven\'t set your timezone. Set it with `/timezone set`, then times like "8pm" mean your 8pm.')).catch(() => {});
  }
}

export async function runPlans(i: ChatInputCommandInteraction): Promise<void> {
  const plans = await store.upcomingPlans(scopeOf(i));
  const lines: string[] = [];
  for (const p of plans) {
    const t = Math.floor(p.starts_at / 1000);
    const going = (await store.planRsvps(p.id)).filter(r => r.status === 'going').length;
    const link = planLink(p);
    lines.push(`**${trunc(p.title, 80)}** · ${p.all_day ? `<t:${t}:D>` : `<t:${t}:f>`} (<t:${t}:R>) · ${going} going${link ? ` · [open](${link})` : ''}`);
  }
  await i.reply(panel({
    title: `📅 Plans in ${placeName(placeOf(i))}`,
    body: lines.length ? lines.join('\n') : 'Nothing planned yet. Make a plan with `/community plan new`.',
    footer: 'Times show in your own timezone',
    color: GREEN,
  }));
}

onComponent('gc:plan:', async i => {
  if (!i.isButton()) return;
  const [, , rawId, action] = i.customId.split(':');
  const plan = await store.getPlan(Number(rawId));
  if (!plan) {
    await i.update(panel({ title: '📅 Plan cancelled', body: 'This plan was cancelled, or it ended long ago.', color: GREY }));
    return;
  }
  if (plan.scope_id !== scopeOf(i)) return oops(i, 'That plan belongs to another chat.');
  const now = Date.now();

  if (action === 'going' || action === 'maybe' || action === 'no') {
    if (now <= plan.starts_at + store.PLAN_GRACE_MS) await store.toggleRsvp(plan.id, i.user.id, action);
    await i.update(await planPanel(plan, now));
    return;
  }

  if (action === 'remind') {
    if (plan.starts_at <= now) return oops(i, 'This plan has already started.');
    const message = `📅 **${plan.title}** starts <t:${Math.floor(plan.starts_at / 1000)}:R>`;
    if ((await db.getReminders(i.user.id)).some(r => r.message === message)) return oops(i, 'You already have a reminder for this plan. See it with `/community reminder list`.');
    const firesAt = Math.max(now, plan.starts_at - REMIND_BEFORE_MS);
    await db.createReminder(i.user.id, i.channelId, i.guildId, message, firesAt);
    const where = botCanPost(i) ? '' : ' in your DMs, since I can\'t post in this chat';
    await i.reply(privately(`🔔 I'll remind you <t:${Math.floor(firesAt / 1000)}:R>${where}. Cancel it with \`/community reminder delete\`.`, GREEN));
    return;
  }

  // Anyone may press "Keep it", so a planner who opened the cancel question and walked away doesn't block everyone's answers.
  if (action === 'keep') { await i.update(await planPanel(plan, now)); return; }
  if (action === 'cancel' || action === 'cancel-yes') {
    if (i.user.id !== plan.created_by) return oops(i, 'Only the person who made this plan can cancel it.');
    if (action === 'cancel-yes') {
      await store.deletePlan(plan.id);
      await i.update(panel({ title: `📅 ~~${plan.title}~~`, body: `Cancelled by <@${i.user.id}>.`, color: GREY }));
      return;
    }
    await i.update(await planPanel(plan, now, true));
  }
});
