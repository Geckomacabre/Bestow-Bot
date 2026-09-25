import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, ModalBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type ChatInputCommandInteraction, type ModalSubmitInteraction,
} from 'discord.js';
import { chat as realChat, modelLabel, sanitizeReply, LlmUnavailable, type ChatMessage, type ChatOptions, type LlmKind } from '../services/llm.js';
import { premiumConfigured, premiumOf } from '../premium/index.js';
import { checkLimit, freeLimit, limitMessage, refund, usage } from './limits.js';

/**
 * The "answer card" for AI replies, and multi-turn conversations:
 *
 *   ┌ prompt (title) ─────────────────────────┐
 *   │ answer                                   │
 *   │ model • 1/20 hourly • Results are AI…    │
 *   └──────────────────────────────────────────┘
 *   [ Reply 1/3 ]   ← opens a box; your reply continues the SAME conversation
 *
 * Conversations live in memory for 30 minutes (never on disk) and only the person who started one can reply to it.
 */

export const MAX_REPLIES = 3;
export const SESSION_TTL_MS = 30 * 60_000;
const MAX_SESSIONS = 2000;
export const COLOR = 0x10a37f;

export interface View { title: string; answer: string; footer: string }
export interface Session { userId: string; system: string; history: ChatMessage[]; replies: number; kind: LlmKind; view: View; expires: number; busy: boolean }

const sessions = new Map<string, Session>();
export const sessionCount = () => sessions.size;
export const getSession = (sid: string) => { const s = sessions.get(sid); if (s && s.expires < Date.now()) { sessions.delete(sid); return undefined; } return s; };
export function resetSessions(): void { sessions.clear(); }

function gc(now = Date.now()) {
  if (sessions.size < MAX_SESSIONS) return;
  for (const [k, s] of sessions) if (s.expires < now) sessions.delete(k);
  while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value as string); // still full: drop the oldest
}

const newId = () => [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, '0')).join('');
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** "OpenAI GPT • 1/20 hourly • Results are AI generated • Premium users get unlimited requests" */
export function footerFor(userId: string, kind: LlmKind, premium: boolean, now = Date.now()): string {
  const u = usage(userId, now, premium);
  const parts = [modelLabel(kind), premium ? 'Premium' : u.limit ? `${u.used}/${u.limit} hourly` : null, 'Results are AI generated'];
  if (!premium && premiumConfigured()) parts.push('Premium users get unlimited requests');
  return parts.filter(Boolean).join(' • ');
}

export const replyLabel = (replies: number) => `Reply ${replies + 1}/${MAX_REPLIES}`;

/** The Components V2 message for one turn. `sid` = null means no Reply button (limit reached, or expired). */
export function render(v: View, sid: string | null, replies: number) {
  const c = new ContainerBuilder().setAccentColor(COLOR)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${trunc(v.title.replace(/\s+/g, ' '), 200)}`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(trunc(v.answer, 3400)))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${trunc(v.footer, 300)}`));
  if (sid && replies < MAX_REPLIES) {
    c.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`ai:reply:${sid}`).setLabel(replyLabel(replies)).setStyle(ButtonStyle.Primary)));
  }
  return { flags: MessageFlags.IsComponentsV2 as const, components: [c], allowedMentions: { parse: [] as never[] } };
}

export interface StartOpts { title: string; system: string; user: ChatMessage; answer: string; kind: LlmKind; premium: boolean }

const MAX_KEPT_IMAGE = 1_500_000;

/** Keeps memory bounded: an image bigger than ~1.5 MB isn't carried into follow-up turns (the text of the exchange still is). */
export function slim(m: ChatMessage): ChatMessage {
  if (typeof m.content === 'string') return m;
  return { ...m, content: m.content.map(p => (p.type === 'image_url' && p.image_url.url.length > MAX_KEPT_IMAGE ? { type: 'text' as const, text: '[a large image was attached here]' } : p)) };
}

/** Stores a new conversation after its first answer and returns the message to send. */
export function startConversation(userId: string, o: StartOpts) {
  gc();
  const sid = newId();
  const view: View = { title: o.title, answer: sanitizeReply(o.answer, 3400), footer: footerFor(userId, o.kind, o.premium) };
  sessions.set(sid, { userId, system: o.system, history: [slim(o.user), { role: 'assistant', content: o.answer }], replies: 0, kind: o.kind, view, expires: Date.now() + SESSION_TTL_MS, busy: false });
  return render(view, sid, 0);
}

const say = (content: string) => ({ content, flags: MessageFlags.Ephemeral as const });

/** The person pressed "Reply n/3": check it's theirs and open the input box. */
export async function handleReplyButton(i: ButtonInteraction): Promise<void> {
  const sid = i.customId.split(':')[2] ?? '';
  const s = getSession(sid);
  if (!s) { await i.reply(say('⌛ This conversation has expired — start a new one with `/ai chatgpt`.')); return; }
  if (s.userId !== i.user.id) { await i.reply(say(`Only <@${s.userId}> can reply to this conversation — start your own with \`/ai chatgpt\`.`)); return; }
  if (s.replies >= MAX_REPLIES) { await i.reply(say('That conversation has reached its reply limit — start a new one with `/ai chatgpt`.')); return; }
  await i.showModal(new ModalBuilder().setCustomId(`ai:modal:${sid}`).setTitle(`Reply (${s.replies + 1}/${MAX_REPLIES})`).addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('text').setLabel('Your reply').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1500))));
}

export interface ReplyDeps { chat: (messages: ChatMessage[], opts?: ChatOptions) => Promise<string> }

/** The person submitted the input box: count it against their limit, ask the model with the whole conversation, post the next turn. */
export async function handleReplyModal(i: ModalSubmitInteraction, deps: ReplyDeps = { chat: realChat }): Promise<void> {
  const sid = i.customId.split(':')[2] ?? '';
  const s = getSession(sid);
  if (!s) { await i.reply(say('⌛ This conversation has expired — start a new one with `/ai chatgpt`.')); return; }
  if (s.userId !== i.user.id) { await i.reply(say('That conversation belongs to someone else.')); return; }
  const text = i.fields.getTextInputValue('text').trim();
  if (!text) { await i.reply(say('Your reply was empty.')); return; }
  if (s.busy) { await i.reply(say('One moment — I\'m still answering your last message.')); return; }
  if (s.replies >= MAX_REPLIES) { await i.reply(say('That conversation has reached its reply limit.')); return; }

  const prem = (await premiumOf(i)).premium;
  const lim = checkLimit(i.user.id, Date.now(), prem);
  if (!lim.ok) { await i.reply(say(limitMessage(lim))); return; }

  s.busy = true;
  const before = { view: s.view, replies: s.replies };
  try {
    // Acknowledge straight away by taking the (now used) button off the old message; the model call can then take as long as it needs.
    if (i.isFromMessage()) await i.update(render(s.view, null, s.replies));
    else await i.deferReply();
    const userMsg: ChatMessage = { role: 'user', content: text };
    const answer = await deps.chat([{ role: 'system', content: s.system }, ...s.history, userMsg], { kind: s.kind });
    s.history.push(userMsg, { role: 'assistant', content: answer });
    s.replies++;
    s.view = { title: text, answer: sanitizeReply(answer, 3400), footer: footerFor(i.user.id, s.kind, prem) };
    s.expires = Date.now() + SESSION_TTL_MS;
    await i.followUp(render(s.view, sid, s.replies));
  } catch (err) {
    refund(i.user.id);
    s.view = before.view; s.replies = before.replies;
    if (!(err instanceof LlmUnavailable)) console.error('[ai reply]', (err as Error).message);
    // Put the button back on the old message so they can try again, and explain in private.
    await i.editReply(render(before.view, sid, before.replies)).catch(() => {});
    await i.followUp(say(err instanceof LlmUnavailable ? err.message : '😵 I couldn\'t answer that just now — your Reply button is back, try again in a moment.')).catch(() => {});
  } finally { s.busy = false; }
}

/** Shown by /ai usage. */
export function usageLines(userId: string, premium: { premium: boolean; source: string | null; expiresAt: number | null }, now = Date.now()): string[] {
  const u = usage(userId, now, premium.premium);
  const lines = premium.premium
    ? [`✨ **Premium** — unlimited AI requests${premium.expiresAt ? ` (until <t:${Math.floor(premium.expiresAt / 1000)}:R>)` : ''}.`, `Requests in the last hour: **${u.used}**.`]
    : [`**${u.used}/${freeLimit()}** AI requests used this hour — **${u.remaining}** left.`, u.resetsInMs ? `Your oldest request drops off <t:${Math.floor((now + u.resetsInMs) / 1000)}:R>.` : 'Your hour is fresh.'];
  if (!premium.premium && premiumConfigured()) lines.push('Premium removes the limit — see `/premium buy`.');
  return lines;
}

export type { ChatInputCommandInteraction };
