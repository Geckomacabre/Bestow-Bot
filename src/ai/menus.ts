import { randomBytes } from 'node:crypto';
import { ActionRowBuilder, MessageFlags, StringSelectMenuBuilder, type Message, type MessageContextMenuCommandInteraction } from 'discord.js';
import { getBufferPublic } from '../framework/http.js';
import { onComponent } from '../framework/router.js';
import { card, trunc } from '../lookups/card.js';
import { friendlyError } from '../lookups/handler.js';
import { gtranslate } from '../lookups/textfun.js';
import { languageName } from '../lookups/languages.js';
import { ask, chat, llmConfigured, sanitizeReply } from '../services/llm.js';
import { premiumOf } from '../premium/index.js';
import { checkLimit, limitMessage, refund } from './limits.js';
import { DESCRIBE_SYSTEM, EXPLAIN_SYSTEM, OCR_SYSTEM, REPLY_IDEAS_SYSTEM, SUMMARIZE_SYSTEM } from './prompts.js';
import { userContent } from './chat.js';
import { imageUrlToDataUri } from './vision.js';
import { transcribe, whisperConfig } from './transcribe.js';

/** The message menus Heist has: AI Tools, Transcribe Audio and Translate Message. */

const COLOR = 0x9b59b6;
const images = (m: Message) => [...m.attachments.values()].filter(a => a.contentType?.startsWith('image/') && !a.contentType.includes('svg')).map(a => a.url)
  .concat(m.embeds.map(e => e.image?.url ?? e.thumbnail?.url).filter((u): u is string => !!u)).slice(0, 4);

// ─── AI Tools ────────────────────────────────────────────────────────────────

export const AI_TOOLS = [
  { id: 'summarize', label: 'Summarize', emoji: '📄', needs: 'text' },
  { id: 'explain', label: 'Explain', emoji: '💡', needs: 'text' },
  { id: 'replies', label: 'Suggest replies', emoji: '💬', needs: 'text' },
  { id: 'translate', label: 'Translate to English', emoji: '🌐', needs: 'text' },
  { id: 'describe', label: 'Describe image', emoji: '🖼️', needs: 'image' },
  { id: 'ocr', label: 'Read text in image', emoji: '📝', needs: 'image' },
] as const;
type Tool = (typeof AI_TOOLS)[number]['id'];

interface Snap { owner: string; text: string; images: string[]; at: number }
const TTL = 15 * 60_000;
const snaps = new Map<string, Snap>();

export function toolsFor(text: string, imgs: number) {
  return AI_TOOLS.filter(t => (t.needs === 'text' ? !!text.trim() : imgs > 0));
}
const menu = (id: string, text: string, imgs: number) => new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
  new StringSelectMenuBuilder().setCustomId(`aitools:${id}`).setPlaceholder('Pick an AI tool').addOptions(toolsFor(text, imgs).map(t => ({ label: t.label, value: t.id, emoji: t.emoji }))));

export async function aiToolsMenu(i: MessageContextMenuCommandInteraction) {
  const m = i.targetMessage, text = m.content ?? '', imgs = images(m);
  if (!text.trim() && !imgs.length) { await i.reply({ content: '❌ That message has no text or images for the AI to work with.', flags: MessageFlags.Ephemeral }); return; }
  for (const [k, v] of snaps) if (Date.now() - v.at > TTL) snaps.delete(k);
  const id = randomBytes(6).toString('hex');
  snaps.set(id, { owner: i.user.id, text: text.slice(0, 4000), images: imgs, at: Date.now() });
  const c = card({ title: '🤖 AI Tools', color: COLOR, description: `What should I do with ${m.author ? `**${m.author.displayName ?? m.author.username}**'s` : 'this'} message?` });
  await i.reply({ ...c, components: [...c.components, menu(id, text, imgs.length)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral } as never);
}

async function runTool(tool: Tool, s: Snap): Promise<{ title: string; body: string; footer: string }> {
  if (tool === 'translate') { const r = await gtranslate(s.text.slice(0, 1500), 'en'); return { title: '🌐 Translation', body: r.text, footer: `From ${languageName(r.detected)} · Google Translate` }; }
  if (tool === 'describe' || tool === 'ocr') {
    if (!llmConfigured('vision')) throw new Error('Image understanding isn\'t configured on this bot.');
    const uri = await imageUrlToDataUri(s.images[0]!);
    const out = await chat([{ role: 'system', content: tool === 'ocr' ? OCR_SYSTEM : DESCRIBE_SYSTEM }, { role: 'user', content: userContent(tool === 'ocr' ? 'Transcribe the text in this image.' : 'Describe this image.', [uri]) }], { kind: 'vision', temperature: 0.2, maxTokens: 900 });
    return { title: tool === 'ocr' ? '📝 Text in image' : '🖼️ Image description', body: out, footer: 'AI-generated — it can be wrong.' };
  }
  if (!llmConfigured()) throw new Error('The AI isn\'t set up on this bot yet.');
  const system = tool === 'summarize' ? SUMMARIZE_SYSTEM : tool === 'explain' ? EXPLAIN_SYSTEM : REPLY_IDEAS_SYSTEM;
  const out = await ask(system, s.text, { temperature: tool === 'replies' ? 0.9 : 0.3, maxTokens: 500 });
  return { title: tool === 'summarize' ? '📄 Summary' : tool === 'explain' ? '💡 Explanation' : '💬 Reply ideas', body: out, footer: 'AI-generated — it can be wrong.' };
}

onComponent('aitools:', async c => {
  if (!c.isStringSelectMenu()) return;
  const id = c.customId.split(':')[1]!, s = snaps.get(id);
  if (!s) { await c.reply({ content: 'This has expired — use AI Tools on the message again.', flags: MessageFlags.Ephemeral }); return; }
  if (s.owner !== c.user.id) { await c.reply({ content: 'That menu isn\'t yours.', flags: MessageFlags.Ephemeral }); return; }
  const tool = c.values[0] as Tool;
  const lim = tool === 'translate' ? { ok: true as const } : checkLimit(c.user.id, Date.now(), (await premiumOf(c)).premium);
  await c.deferUpdate();
  let result: ReturnType<typeof card>;
  if (!lim.ok) result = card({ title: '⏳ Slow down', color: 0xed4245, description: limitMessage(lim) });
  else {
    try {
      const r = await runTool(tool, s);
      result = card({ title: r.title, color: COLOR, description: sanitizeReply(r.body, 3200), footer: r.footer });
    } catch (e) {
      if (tool !== 'translate') refund(c.user.id);
      result = card({ title: '❌ Couldn\'t do that', color: 0xed4245, description: friendlyError(e) });
    }
  }
  await c.editReply({ ...result, components: [...result.components, menu(id, s.text, s.images.length)] } as never);
});

// ─── Transcribe Audio ────────────────────────────────────────────────────────

export async function transcribeMenu(i: MessageContextMenuCommandInteraction) {
  const a = [...i.targetMessage.attachments.values()].find(x => /^(audio|video)\//.test(x.contentType ?? ''));
  if (!a) { await i.reply({ content: '❌ That message has no voice message, audio or video to transcribe.', flags: MessageFlags.Ephemeral }); return; }
  if (!whisperConfig()) { await i.reply({ content: '❌ Speech-to-text isn\'t configured on this bot yet.', flags: MessageFlags.Ephemeral }); return; }
  const lim = checkLimit(i.user.id, Date.now(), (await premiumOf(i)).premium);
  if (!lim.ok) { await i.reply({ content: `⏳ ${limitMessage(lim)}`, flags: MessageFlags.Ephemeral }); return; }
  await i.deferReply();
  try {
    const r = await transcribe(await getBufferPublic(a.url, { maxBytes: 50 * 1024 * 1024, timeoutMs: 40_000 }), a.name);
    await i.editReply(card({ title: '🎙️ Transcript', color: COLOR, description: sanitizeReply(r.text || '*(no speech found)*', 3200), footer: `${r.seconds ? `${Math.round(r.seconds)}s of audio · ` : ''}AI-generated, may contain errors` }));
  } catch (e) {
    refund(i.user.id);
    await i.editReply(card({ title: '❌ Couldn\'t transcribe that', color: 0xed4245, description: friendlyError(e) }));
  }
}

// ─── Translate Message ───────────────────────────────────────────────────────

/** Discord locale ("en-US", "pt-BR", "zh-CN") → a Google Translate code. */
export function localeLang(locale: string | null | undefined): string {
  const l = (locale ?? 'en').toLowerCase();
  if (l === 'zh-cn') return 'zh-CN';
  if (l === 'zh-tw') return 'zh-TW';
  if (l === 'pt-br') return 'pt';
  if (l === 'es-es' || l === 'es-419') return 'es';
  return l.split('-')[0]!;
}

export async function translateMenu(i: MessageContextMenuCommandInteraction) {
  const text = i.targetMessage.content?.trim();
  if (!text) { await i.reply({ content: '❌ That message has no text to translate.', flags: MessageFlags.Ephemeral }); return; }
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const to = localeLang(i.locale);
  try {
    const r = await gtranslate(text.slice(0, 1500), to);
    await i.editReply(card({ title: '🌐 Translation', color: 0x4285f4, fields: [[`${languageName(r.detected)} (detected)`, trunc(text, 1000)], [languageName(to), trunc(r.text, 1800)]], footer: 'Google Translate' }));
  } catch (e) {
    await i.editReply(card({ title: '❌ Couldn\'t translate that', color: 0xed4245, description: friendlyError(e) }));
  }
}
