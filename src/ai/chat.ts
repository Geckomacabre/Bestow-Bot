import type { Message } from 'discord.js';
import { chat as realChat, LlmUnavailable, llmConfigured, sanitizeReply, type ChatMessage, type ChatOptions, type ImagePart, type TextPart } from '../services/llm.js';
import { checkLimit, limitMessage, refund } from './limits.js';
import { buildSystem } from './prompts.js';
import { getGuildAi, getPersona, notesForPrompt } from './store.js';
import { imageUrlToDataUri } from './vision.js';

/** Chat on mention / reply / DM. The only context used is the reply chain the person is already in — no channel history, no hidden buffer. */

export const MAX_CHAIN = 6;
export const MAX_IMAGES = 2;
const MAX_TEXT = 1500;

export type Outcome = 'ignored' | 'replied' | 'limited' | 'unavailable' | 'error';

export interface Deps {
  chat: (messages: ChatMessage[], opts?: ChatOptions) => Promise<string>;
  toDataUri: (url: string) => Promise<string>;
  now: () => Date;
}
export const defaultDeps: Deps = { chat: realChat, toDataUri: imageUrlToDataUri, now: () => new Date() };

export const stripMention = (content: string, botId: string) => content.replace(new RegExp(`<@!?${botId}>`, 'g'), '').replace(/\s+/g, ' ').trim();

export function userContent(text: string, images: string[]): string | (TextPart | ImagePart)[] {
  if (!images.length) return text;
  return [{ type: 'text', text: text || 'What do you see in this image?' }, ...images.map((url): ImagePart => ({ type: 'image_url', image_url: { url } }))];
}

/** Older turns first. Bot messages become `assistant`, everyone else `user` prefixed with their display name so the model can tell speakers apart. */
export function chainToMessages(chain: { authorId: string; name: string; content: string }[], botId: string): ChatMessage[] {
  return chain.filter(m => m.content.trim()).map((m): ChatMessage => m.authorId === botId
    ? { role: 'assistant', content: m.content.slice(0, MAX_TEXT) }
    : { role: 'user', content: `${m.name}: ${m.content.slice(0, MAX_TEXT)}` });
}

async function referenceChain(message: Message, botId: string): Promise<{ authorId: string; name: string; content: string }[]> {
  const out: { authorId: string; name: string; content: string }[] = [];
  let cur: Message = message;
  for (let i = 0; i < MAX_CHAIN && cur.reference?.messageId; i++) {
    try { cur = await cur.fetchReference(); } catch { break; }
    out.unshift({ authorId: cur.author.id, name: cur.member?.displayName ?? cur.author.displayName ?? cur.author.username, content: stripMention(cur.content ?? '', botId) });
  }
  return out;
}

export async function shouldRespond(message: Message): Promise<boolean> {
  const me = message.client.user;
  if (!me || message.author.bot || message.system) return false;
  if (!message.guildId) return true; // DMs: always
  if (message.mentions.users.has(me.id) && !message.mentions.everyone) return true;
  if (message.reference?.messageId) {
    try { return (await message.fetchReference()).author.id === me.id; } catch { return false; }
  }
  return false;
}

export async function handleAiMessage(message: Message, deps: Deps = defaultDeps): Promise<Outcome> {
  const me = message.client.user;
  if (!me || !(await shouldRespond(message))) return 'ignored';
  if (!llmConfigured()) return message.guildId ? 'ignored' : (await message.reply('The AI isn\'t set up on this bot yet.').catch(() => {}), 'unavailable');
  const guild = message.guildId ? await getGuildAi(message.guildId) : { enabled: true, persona: null };
  if (!guild.enabled) return 'ignored';

  const text = stripMention(message.content ?? '', me.id);
  const imageAtts = [...message.attachments.values()].filter(a => a.contentType?.startsWith('image/') && !a.contentType.includes('svg')).slice(0, MAX_IMAGES);
  if (!text && !imageAtts.length) { await message.reply({ content: '👋 Ask me anything — for example: `@me explain how tides work`.', allowedMentions: { parse: [], repliedUser: false } }).catch(() => {}); return 'replied'; }

  const lim = checkLimit(message.author.id);
  if (!lim.ok) { await message.reply({ content: limitMessage(lim), allowedMentions: { parse: [], repliedUser: false } }).catch(() => {}); return 'limited'; }

  try {
    await ('sendTyping' in message.channel ? message.channel.sendTyping() : Promise.resolve()).catch(() => {});
    let images: string[] = [];
    if (imageAtts.length && llmConfigured('vision')) images = await Promise.all(imageAtts.map(a => deps.toDataUri(a.url)));
    const name = message.member?.displayName ?? message.author.displayName ?? message.author.username;
    const system = buildSystem({ guildPersona: guild.persona, userPersona: await getPersona(message.author.id), notes: await notesForPrompt(message.author.id), userName: name, guildName: message.guild?.name, now: deps.now() });
    const history = chainToMessages(await referenceChain(message, me.id), me.id);
    const reply = await deps.chat([{ role: 'system', content: system }, ...history, { role: 'user', content: userContent(text, images) }], { kind: images.length ? 'vision' : 'chat' });
    await message.reply({ content: sanitizeReply(reply), allowedMentions: { parse: [], repliedUser: false } });
    return 'replied';
  } catch (err) {
    refund(message.author.id);
    if (err instanceof LlmUnavailable) return 'unavailable';
    console.error('[ai chat]', (err as Error).message);
    await message.reply({ content: '😵 I couldn\'t come up with an answer just now — try again in a moment.', allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
    return 'error';
  }
}
