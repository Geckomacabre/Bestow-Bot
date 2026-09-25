import {
  ActionRowBuilder, AttachmentBuilder, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, ModalBuilder, StringSelectMenuBuilder,
  TextDisplayBuilder, TextInputBuilder, TextInputStyle, type ChatInputCommandInteraction,
} from 'discord.js';
import type { Sub } from '../../framework/group.js';
import { hsub } from '../../framework/heist.js';
import { getBufferPublic } from '../../framework/http.js';
import { MediaError, uploadLimit } from '../../framework/media.js';
import { onComponent } from '../../framework/router.js';
import { makeVoiceMessage, sendVoiceMessage } from '../../framework/voicemessage.js';
import { card, trunc } from '../../lookups/card.js';
import { lookup, LookupError } from '../../lookups/handler.js';
import { chat, LlmUnavailable, sanitizeReply } from '../../services/llm.js';
import { checkLimit, limitMessage, refund } from '../../ai/limits.js';
import { premiumOf } from '../../premium/index.js';
import { buildSystem, DEEPGEOLOCATE_SYSTEM } from '../../ai/prompts.js';
import { userContent } from '../../ai/chat.js';
import { imageUrlToDataUri } from '../../ai/vision.js';
import { editImage, imagine, type ImagineModel } from '../../ai/images.js';
import { openaiSpeech, sonar } from '../../ai/services.js';
import * as custom from '../../ai/custom.js';
import { aiRun, imageTask } from './ai.js';

/** Heist's newer /ai commands: imagine, edit-imagine, deepgeolocate, perplexity, tts openai and the custom AI. */

const COLOR = 0x9b59b6;

/** Like aiRun, for tools that don't use the chat model: the usage limit, and the request given back if the provider failed. */
function limited(fn: (i: ChatInputCommandInteraction) => Promise<unknown>) {
  return lookup(async i => {
    const lim = checkLimit(i.user.id, Date.now(), (await premiumOf(i)).premium);
    if (!lim.ok) throw new LookupError(limitMessage(lim));
    try { await fn(i); } catch (e) {
      if (!(e instanceof LookupError) && !(e instanceof MediaError)) refund(i.user.id);
      if (e instanceof LlmUnavailable) throw new LookupError(e.message);
      throw e;
    }
  });
}

function imageReply(title: string, png: Buffer, footer: string) {
  const file = new AttachmentBuilder(png, { name: 'image.png' });
  const box = new ContainerBuilder().setAccentColor(COLOR)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${trunc(title, 200)}`))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://image.png')))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footer}`));
  return { flags: MessageFlags.IsComponentsV2, components: [box], files: [file], allowedMentions: { parse: [] as never[] } };
}

async function imageAttachment(i: ChatInputCommandInteraction, opt: string, required: boolean) {
  const a = i.options.getAttachment(opt, required);
  if (!a) return null;
  if (!a.contentType?.startsWith('image/')) throw new LookupError(`\`${opt}\` must be an image.`);
  return a;
}

// ─── Images ──────────────────────────────────────────────────────────────────

const imagineSub = hsub('ai imagine', limited(async i => {
  const model = i.options.getString('model', true) as ImagineModel, prompt = i.options.getString('prompt', true);
  const png = await imagine(model, prompt);
  await i.editReply(imageReply(`🎨 ${prompt}`, png, `${model} · AI-generated`) as never);
}), { tweaks: { prompt: { maxLength: 1000 } } });

const editSub = hsub('ai edit-imagine', limited(async i => {
  const a = (await imageAttachment(i, 'image', true))!, prompt = i.options.getString('prompt', true);
  const src = await getBufferPublic(a.url, { maxBytes: 10 * 1024 * 1024, timeoutMs: 20_000 });
  const png = await editImage(src, prompt);
  await i.editReply(imageReply(`🖌️ ${prompt}`, png, 'Edited with AI') as never);
}), { tweaks: { prompt: { maxLength: 1000 } } });

const deepGeoSub = hsub('ai deepgeolocate', aiRun(i => imageTask(i, DEEPGEOLOCATE_SYSTEM, 'Analyse this photo in depth and work out where it was taken.', '🌍 Deep geolocation', 1200), { needs: 'vision' }));

// ─── Perplexity ──────────────────────────────────────────────────────────────

const perplexitySub = hsub('ai perplexity', limited(async i => {
  const q = i.options.getString('query', true), a = await imageAttachment(i, 'image', false);
  const r = await sonar(q, a ? await imageUrlToDataUri(a.url) : null);
  await i.editReply(card({
    title: `🔎 ${trunc(q, 200)}`, color: 0x20808d, description: sanitizeReply(r.text, 3200),
    fields: r.sources.length ? [['Sources', r.sources.map((s, n) => `${n + 1}. [${trunc(s.title, 60)}](${s.url})`).join('\n')]] : [],
    footer: 'Perplexity Sonar',
  }));
}), { tweaks: { query: { maxLength: 1000 } } });

// ─── OpenAI voices ───────────────────────────────────────────────────────────

const ttsOpenAiSub = hsub('ai tts openai', limited(async i => {
  const voice = i.options.getString('voice') ?? 'Alloy';
  const mp3 = await openaiSpeech(i.options.getString('text', true), voice);
  if (mp3.length > uploadLimit(i)) throw new LookupError('The audio came out larger than the upload limit — try shorter text.');
  let note = `🗣️ **${voice}**`;
  if (i.options.getBoolean('voicemessage')) {
    const vm = await makeVoiceMessage(mp3).catch(() => null);
    if (vm && (await sendVoiceMessage(i, vm))) { await i.deleteReply().catch(() => {}); return; }
    note += '\n*(couldn\'t send as a voice message here — attached the audio instead)*';
  }
  await i.editReply({ content: note, files: [new AttachmentBuilder(mp3, { name: 'speech.mp3' })] });
}), { tweaks: { text: { maxLength: 2000 } } });

// ─── Custom AI ───────────────────────────────────────────────────────────────

function modelMenu(userId: string, current: string | null) {
  const models = custom.customModels();
  if (models.length < 2) return null;
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`cai:model:${userId}`).setPlaceholder('Pick a model')
    .addOptions(models.map(m => ({ label: trunc(m.label, 100), value: m.id.slice(0, 100), default: m.id === current }))));
}

const buildSub = hsub('ai custom build', async i => {
  const cur = await custom.getCustom(i.user.id);
  const modal = new ModalBuilder().setCustomId('cai:build').setTitle('Build your custom AI').addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Name').setStyle(TextInputStyle.Short).setMaxLength(custom.MAX_NAME).setRequired(true).setValue(cur?.name ?? '')),
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('instructions').setLabel('Personality & instructions').setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('e.g. You are a sarcastic pirate who answers in rhymes.').setMaxLength(custom.MAX_INSTRUCTIONS).setRequired(true).setValue(cur?.instructions ?? '')),
  );
  await i.showModal(modal);
});

const chatCustomSub = hsub('ai custom chat', aiRun(async i => {
  const ai = await custom.getCustom(i.user.id);
  if (!ai) throw new LookupError('You haven\'t built a custom AI yet — use `/ai custom build`.');
  const model = custom.modelFor(ai);
  if (!model) throw new LookupError('No models are available for custom AIs on this bot.');
  const system = buildSystem({ userPersona: `You are "${ai.name}", a custom AI this user built. Their instructions for you: ${ai.instructions}`, userName: i.user.displayName ?? i.user.username, guildName: i.guild?.name });
  const q = i.options.getString('prompt', true);
  const reply = await chat([{ role: 'system', content: system }, { role: 'user', content: userContent(q, []) }], { model: model.id, maxTokens: 800 });
  await i.editReply(card({ title: `🤖 ${ai.name}`, color: COLOR, description: `> ${trunc(q, 300)}\n\n${sanitizeReply(reply, 3200)}`, footer: `Custom AI · ${model.label}` }));
}), { tweaks: { prompt: { maxLength: 1500 } } });

const modelsSub = hsub('ai custom models', async i => {
  const models = custom.customModels(), ai = await custom.getCustom(i.user.id);
  const current = ai ? custom.modelFor(ai)?.id ?? null : null;
  const lines = models.length ? models.map(m => `${m.id === current ? '✅' : '•'} **${m.label}**${m.label !== m.id ? ` · \`${m.id}\`` : ''}`) : ['No models are available on this bot yet.'];
  const menu = ai ? modelMenu(i.user.id, current) : null;
  const c = card({ title: '🧠 Custom AI models', color: COLOR, description: `${lines.join('\n')}${ai ? '' : '\n\n-# Build your AI first with \`/ai custom build\`.'}` });
  await i.reply({ ...c, components: [...c.components, ...(menu ? [menu] : [])], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral } as never);
});

onComponent('cai:', async c => {
  if (c.isModalSubmit() && c.customId === 'cai:build') {
    try {
      const ai = await custom.saveCustom(c.user.id, c.fields.getTextInputValue('name'), c.fields.getTextInputValue('instructions'));
      const menu = modelMenu(c.user.id, custom.modelFor(ai)?.id ?? null);
      await c.reply({ content: `✅ **${ai.name}** is ready — talk to it with \`/ai custom chat\`.${menu ? ' Pick its model below:' : ''}`, components: menu ? [menu] : [], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    } catch (e) {
      await c.reply({ content: `❌ ${e instanceof custom.CustomAiError ? e.message : 'Couldn\'t save that.'}`, flags: MessageFlags.Ephemeral });
    }
    return;
  }
  if (c.isStringSelectMenu() && c.customId.startsWith('cai:model:')) {
    if (c.customId.split(':')[2] !== c.user.id) { await c.reply({ content: 'That menu isn\'t yours.', flags: MessageFlags.Ephemeral }); return; }
    try {
      await custom.setCustomModel(c.user.id, c.values[0]!);
      const label = custom.customModels().find(m => m.id === c.values[0])?.label ?? c.values[0];
      await c.reply({ content: `✅ Your custom AI now runs on **${label}**.`, flags: MessageFlags.Ephemeral });
    } catch (e) {
      await c.reply({ content: `❌ ${e instanceof custom.CustomAiError ? e.message : 'Couldn\'t change the model.'}`, flags: MessageFlags.Ephemeral });
    }
  }
});

export const aiHeistSubs: Sub[] = [imagineSub, editSub, deepGeoSub, perplexitySub];
export const aiTtsSubs: Sub[] = [ttsOpenAiSub];
export const aiCustomSubs: Sub[] = [buildSub, chatCustomSub, modelsSub];
