import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction, type SlashCommandSubcommandBuilder } from 'discord.js';
import type { Sub, SubGroup } from '../../framework/group.js';
import { findMedia, MediaError, mediaOptions } from '../../framework/media.js';
import { getBufferPublic } from '../../framework/http.js';
import { card, trunc } from '../../lookups/card.js';
import { friendlyError, lookup, LookupError } from '../../lookups/handler.js';
import { chat, ask, LlmUnavailable, llmConfigured, sanitizeReply, type ChatMessage, type LlmKind } from '../../services/llm.js';
import { startConversation, usageLines } from '../../ai/conversation.js';
import { checkLimit, limitMessage, refund } from '../../ai/limits.js';
import { premiumOf } from '../../premium/index.js';
import { buildSystem, DESCRIBE_SYSTEM, FUN_KINDS, FUN_SYSTEM, funKind, GEOLOCATE_SYSTEM, OCR_SYSTEM, SUMMARIZE_SYSTEM } from '../../ai/prompts.js';
import { userContent } from '../../ai/chat.js';
import { imageUrlToDataUri } from '../../ai/vision.js';
import { transcribe, whisperConfig } from '../../ai/transcribe.js';
import { factcheck } from '../../ai/factcheck.js';
import * as store from '../../ai/store.js';

const COLOR = 0x9b59b6;
const name_ = (i: ChatInputCommandInteraction) => i.user.displayName ?? i.user.username;
const str = (n: string, d: string, max: number, required = true) => (s: SlashCommandSubcommandBuilder) => s.addStringOption(o => o.setName(n).setDescription(d).setRequired(required).setMaxLength(max));

/**
 * Wraps an AI subcommand: defers, checks the per-user limit, turns provider errors into friendly text,
 * and gives the request back if the provider (not the person) was the problem.
 */
export function aiRun(fn: (i: ChatInputCommandInteraction, ctx: { premium: boolean }) => Promise<unknown>, opts: { needs?: LlmKind } = {}) {
  return lookup(async i => {
    if (!llmConfigured(opts.needs ?? 'chat')) throw new LookupError(opts.needs === 'vision' ? 'Image understanding isn\'t configured on this bot (set VISION_MODEL or use a vision-capable LLM_MODEL).' : 'The AI isn\'t set up on this bot yet — the owner needs to set LLM_BASE_URL and LLM_MODEL.');
    const premium = (await premiumOf(i)).premium;
    const lim = checkLimit(i.user.id, Date.now(), premium);
    if (!lim.ok) throw new LookupError(limitMessage(lim));
    try { await fn(i, { premium }); } catch (e) {
      if (!(e instanceof LookupError) && !(e instanceof MediaError)) refund(i.user.id);
      if (e instanceof LlmUnavailable) throw new LookupError(e.message);
      throw e;
    }
  });
}

// ─── Core actions ────────────────────────────────────────────────────────────

/** `/ai chatgpt` and `/ai llama`: an answer card with usage in the footer and a "Reply n/3" button that continues the conversation. */
const chatSub = (name: string, description: string, kind: 'chat' | 'llama', withImage: boolean): Sub => ({
  name, description,
  options: s => { str('prompt', 'What do you want to know?', 1500)(s); if (withImage) s.addAttachmentOption(o => o.setName('image').setDescription('An image to ask about (optional)')); return s; },
  run: aiRun(async (i, { premium }) => {
    const q = i.options.getString('prompt', true);
    const att = withImage ? i.options.getAttachment('image') : null;
    let images: string[] = [];
    if (att) {
      if (!att.contentType?.startsWith('image/')) throw new LookupError('That attachment isn\'t an image.');
      if (!llmConfigured('vision')) throw new LookupError('Image understanding isn\'t configured on this bot.');
      images = [await imageUrlToDataUri(att.url)];
    }
    const system = buildSystem({ userPersona: await store.getPersona(i.user.id), notes: await store.notesForPrompt(i.user.id), userName: name_(i), guildName: i.guild?.name });
    const user: ChatMessage = { role: 'user', content: userContent(q, images) };
    const used: LlmKind = images.length ? 'vision' : kind;
    const reply = await chat([{ role: 'system', content: system }, user], { kind: used, maxTokens: 800 });
    await i.editReply(startConversation(i.user.id, { title: q, system, user, answer: reply, kind: used, premium }));
  }, { needs: kind }),
});

const usageSub: Sub = {
  name: 'usage', description: 'Check your AI usage limits',
  run: async i => {
    await i.reply({ ...card({ title: '📊 AI usage', color: COLOR, description: usageLines(i.user.id, await premiumOf(i)).join('\n') }), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
  },
};

async function imageTask(i: ChatInputCommandInteraction, system: string, prompt: string, title: string, maxTokens = 700) {
  const ref = await findMedia(i, 'image');
  const uri = await imageUrlToDataUri(ref.url);
  const out = await chat([{ role: 'system', content: system }, { role: 'user', content: userContent(prompt, [uri]) }], { kind: 'vision', maxTokens, temperature: 0.2 });
  await i.editReply(card({ title, color: COLOR, description: sanitizeReply(out, 3200), thumbnail: ref.url, footer: 'AI-generated — it can be wrong.' }));
}

const imageSubs: Sub[] = [
  { name: 'ocr', description: 'Read the text in an image', options: s => mediaOptions('image', s), run: aiRun(i => imageTask(i, OCR_SYSTEM, 'Transcribe the text in this image.', '📝 Text in image', 1200), { needs: 'vision' }) },
  { name: 'describe', description: 'Describe an image (alt text)', options: s => mediaOptions('image', s), run: aiRun(i => imageTask(i, DESCRIBE_SYSTEM, 'Describe this image.', '🖼️ Image description'), { needs: 'vision' }) },
  {
    name: 'geolocate', description: 'Guess where a photo was taken (country/region only)', options: s => mediaOptions('image', s),
    run: aiRun(i => imageTask(i, GEOLOCATE_SYSTEM, 'Where might this photo have been taken? Give country/region-level guesses and your reasoning.', '🌍 Location guess', 600), { needs: 'vision' }),
  },
];

const transcriptSub: Sub = {
  name: 'transcript', description: 'Turn speech in an audio/video file into text (up to 10 minutes)',
  options: s => mediaOptions('audio', s),
  run: lookup(async i => {
    if (!whisperConfig()) throw new LookupError('Speech-to-text isn\'t configured on this bot yet.');
    const lim = checkLimit(i.user.id, Date.now(), (await premiumOf(i)).premium);
    if (!lim.ok) throw new LookupError(limitMessage(lim));
    try {
      const ref = await findMedia(i, 'audio');
      const buf = await getBufferPublic(ref.url, { maxBytes: 50 * 1024 * 1024, timeoutMs: 40_000 });
      const r = await transcribe(buf, ref.name);
      const text = sanitizeReply(r.text, 3200);
      await i.editReply(card({ title: '🎙️ Transcript', color: COLOR, description: text, footer: r.seconds ? `${Math.round(r.seconds)}s of audio · AI-generated, may contain errors` : 'AI-generated, may contain errors' }));
    } catch (e) { if (!(e instanceof LookupError) && !(e instanceof MediaError)) refund(i.user.id); throw e; }
  }),
};

const summarizeSub: Sub = {
  name: 'summarize', description: 'Summarize a chunk of text', options: str('text', 'The text to summarize', 4000),
  run: aiRun(async i => {
    const t = i.options.getString('text', true);
    if (t.length < 200) throw new LookupError('That\'s already short — give me at least a couple of paragraphs.');
    const out = await ask(SUMMARIZE_SYSTEM, t, { temperature: 0.2, maxTokens: 500 });
    await i.editReply(card({ title: '📄 Summary', color: COLOR, description: sanitizeReply(out, 3000), footer: 'AI-generated summary.' }));
  }),
};

const factcheckSub: Sub = {
  name: 'factcheck', description: 'Check a claim against encyclopedia/web sources', options: str('claim', 'The claim to check', 400),
  run: aiRun(async i => {
    const r = await factcheck(i.options.getString('claim', true));
    const icon: Record<string, string> = { true: '✅', 'mostly true': '🟢', misleading: '🟠', false: '❌', unverifiable: '❔' };
    await i.editReply(card({
      title: `${icon[r.verdict]} ${r.verdict[0]!.toUpperCase()}${r.verdict.slice(1)}`, color: r.verdict === 'false' ? 0xed4245 : r.verdict === 'unverifiable' ? 0x99aab5 : r.verdict === 'true' || r.verdict === 'mostly true' ? 0x57f287 : 0xfee75c,
      description: `> ${trunc(r.claim, 300)}\n\n${r.explanation}`,
      fields: [['Confidence', `${r.confidence}%`], r.sources.length ? ['Sources', r.sources.map(s => `[${trunc(s.title, 60)}](${s.url})`).join('\n')] : null],
      footer: `Checked against ${r.engine === 'none' ? 'no sources' : r.engine} search results — a quick check, not a final answer.`,
    }));
  }),
};

// ─── Fun generators (no message history is read) ─────────────────────────────

const funSub: Sub = {
  name: 'fun', description: 'AI comedy bits: fortune, court, alibi, hot take, roast battle and more',
  options: s => s.addStringOption(o => o.setName('kind').setDescription('What to generate').setRequired(true).addChoices(...FUN_KINDS.map(k => ({ name: k.label, value: k.id }))))
    .addUserOption(o => o.setName('user').setDescription('Who it\'s about (for the bits that need someone)'))
    .addStringOption(o => o.setName('about').setDescription('A topic, detail or opponent to work into it').setMaxLength(200)),
  run: aiRun(async i => {
    const k = funKind(i.options.getString('kind', true));
    if (!k) throw new LookupError('Unknown kind.');
    const u = i.options.getUser('user');
    if (k.target === 'required' && !u && k.id !== 'roastbattle') throw new LookupError(`**${k.label}** needs someone — pick a user.`);
    const who = u ? (u.displayName ?? u.username) : k.target === 'optional' ? name_(i) : '';
    const about = (i.options.getString('about') ?? '').replace(/[\r\n]+/g, ' ').trim();
    const out = await ask(FUN_SYSTEM, k.prompt(who, about), { temperature: 1, maxTokens: 450 });
    await i.editReply(card({ title: `${k.label}${u ? ` · ${who}` : ''}`, color: COLOR, description: `${u ? `<@${u.id}>\n` : ''}${sanitizeReply(out, 3000)}`, footer: 'AI-generated fiction — for fun.' }));
  }),
};

// ─── Persona ─────────────────────────────────────────────────────────────────

const personaSubs: Sub[] = [
  {
    name: 'set', description: 'Give the AI a persona when it talks to you (e.g. "a grumpy pirate")', options: str('persona', 'Who should it act like?', store.MAX_PERSONA),
    run: async i => {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      try { await store.setPersona(i.user.id, i.options.getString('persona', true)); await i.editReply('🎭 Done — the AI will use that persona when it talks to you.'); }
      catch (e) { await i.editReply(e instanceof store.AiStoreError ? `❌ ${e.message}` : '❌ Couldn\'t save that.'); }
    },
  },
  { name: 'show', description: 'See your current AI persona', run: async i => { await i.deferReply({ flags: MessageFlags.Ephemeral }); const p = await store.getPersona(i.user.id); await i.editReply(p ? `🎭 Your persona: *${p}*` : 'You haven\'t set a persona.'); } },
  { name: 'clear', description: 'Remove your AI persona', run: async i => { await i.deferReply({ flags: MessageFlags.Ephemeral }); await store.clearPersona(i.user.id); await i.editReply('🎭 Persona cleared.'); } },
];

// ─── Memory (opt-in) ─────────────────────────────────────────────────────────

const priv = (fn: (i: ChatInputCommandInteraction) => Promise<string>) => async (i: ChatInputCommandInteraction) => {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  try { await i.editReply(await fn(i)); } catch (e) { await i.editReply(e instanceof store.AiStoreError ? `❌ ${e.message}` : `❌ ${friendlyError(e)}`); }
};

const memorySubs: Sub[] = [
  { name: 'on', description: 'Let the AI keep notes you choose to save (off by default)', run: priv(async i => { await store.setMemoryEnabled(i.user.id, true); return '🧠 Memory is **on**. Save notes with `/ai memory remember`. Nothing is saved automatically — only what you tell it to.'; }) },
  { name: 'off', description: 'Turn memory off and erase your saved notes', run: priv(async i => { const n = await store.disableMemory(i.user.id); return `🧠 Memory is **off**${n ? ` and ${n} note${n === 1 ? ' was' : 's were'} erased` : ''}.`; }) },
  { name: 'remember', description: 'Save a note about yourself for the AI to use', options: str('note', 'e.g. "I\'m a nurse who loves cats"', store.MAX_NOTE), run: priv(async i => { const n = await store.addNote(i.user.id, i.options.getString('note', true)); return `🧠 Saved (note #${n.id}).`; }) },
  {
    name: 'list', description: 'See what the AI has saved about you',
    run: priv(async i => { const on = await store.memoryEnabled(i.user.id), notes = await store.listNotes(i.user.id); return `🧠 Memory is **${on ? 'on' : 'off'}**.\n${notes.length ? notes.map(n => `**#${n.id}** ${n.note}`).join('\n') : '*No notes saved.*'}`; }),
  },
  {
    name: 'forget', description: 'Delete one saved note', options: s => s.addIntegerOption(o => o.setName('id').setDescription('The note number from /ai memory list').setRequired(true).setMinValue(1)),
    run: priv(async i => ((await store.forgetNote(i.user.id, i.options.getInteger('id', true))) ? '🧠 Forgotten.' : '❌ You don\'t have a note with that number.')),
  },
  { name: 'clear', description: 'Delete all your saved notes', run: priv(async i => `🧠 ${await store.clearNotes(i.user.id)} note(s) erased.`) },
];

// ─── Server admin config ─────────────────────────────────────────────────────

const needManage = (i: ChatInputCommandInteraction) => {
  if (!i.guildId) throw new store.AiStoreError('This is a server setting — run it in a server.');
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new store.AiStoreError('You need the **Manage Server** permission for that.');
};

const configSubs: Sub[] = [
  { name: 'enable', description: 'Let the bot chat when mentioned or replied to in this server', run: priv(async i => { needManage(i); await store.setGuildEnabled(i.guildId!, true); return '✅ AI chat is **on** here.'; }) },
  { name: 'disable', description: 'Stop the bot chatting when mentioned in this server', run: priv(async i => { needManage(i); await store.setGuildEnabled(i.guildId!, false); return '✅ AI chat is **off** here. (Slash commands under /ai still work.)'; }) },
  {
    name: 'persona', description: 'Set a server-wide style for the AI (leave empty to clear)', options: str('persona', 'e.g. "cheerful pirate captain"', store.MAX_PERSONA, false),
    run: priv(async i => { needManage(i); const p = i.options.getString('persona'); await store.setGuildPersona(i.guildId!, p); return p ? `✅ Server persona set: *${trunc(p, 120)}*` : '✅ Server persona cleared.'; }),
  },
  {
    name: 'status', description: 'Show how the AI is configured here',
    run: priv(async i => {
      const g = i.guildId ? await store.getGuildAi(i.guildId) : { enabled: true, persona: null };
      return `• Chat on mention: **${g.enabled ? 'on' : 'off'}**\n• Server persona: ${g.persona ? `*${trunc(g.persona, 120)}*` : 'none'}\n• AI provider: ${llmConfigured() ? '✅ configured' : '❌ not configured'}\n• Vision: ${llmConfigured('vision') ? '✅' : '❌'} · Speech-to-text: ${whisperConfig() ? '✅' : '❌'}`;
    }),
  },
];

export const aiSubs: Sub[] = [
  chatSub('chatgpt', 'Ask the AI a question (attach an image and it can look at it)', 'chat', true),
  chatSub('llama', 'Ask the Llama model a question', 'llama', false),
  ...imageSubs, transcriptSub, summarizeSub, factcheckSub, funSub, usageSub,
];
export const aiGroups: SubGroup[] = [
  { name: 'persona', description: 'Give the AI a persona for your chats', subs: personaSubs },
  { name: 'memory', description: 'Opt-in notes the AI can remember about you', subs: memorySubs },
  { name: 'config', description: 'Server settings for the AI (Manage Server)', subs: configSubs },
];
