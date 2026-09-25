import { randomBytes } from 'node:crypto';
import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags,
  StringSelectMenuBuilder, TextDisplayBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction, type User,
} from 'discord.js';
import { hgroup, hsub } from '../../framework/heist.js';
import { onComponent } from '../../framework/router.js';
import { card, trunc } from '../../lookups/card.js';
import { generateQuote, type QuoteStyle } from '../../utils/quote.js';
import * as qp from '../../quotes/presets.js';

/**
 * /quotemessage: presets that style your quotes (theme, font, avatar colour, @handle) and how to quote a message. The editor shows
 * a live preview; changes save as you pick them. Editors answer only the person who opened them, for 15 minutes.
 */

const COLOR = 0x2b2d31;
const TTL = 15 * 60_000;
const editors = new Map<string, { owner: string; name: string; at: number }>();

async function preview(user: User, style: QuoteStyle): Promise<Buffer> {
  return generateQuote({ text: 'This is how your quotes will look.', authorName: user.displayName ?? user.username, authorHandle: `@${user.username}`, authorAvatarUrl: user.displayAvatarURL({ extension: 'png', size: 512 }), style });
}

const select = (id: string, part: string, placeholder: string, options: { label: string; value: string; default?: boolean }[]) =>
  new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`qp:${id}:${part}`).setPlaceholder(placeholder).addOptions(options));

async function editorPayload(id: string, user: User, p: qp.Preset) {
  const s = p.style;
  const file = new AttachmentBuilder(await preview(user, s), { name: 'preview.png' });
  const box = new ContainerBuilder().setAccentColor(COLOR)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ✏️ Quote preset: ${trunc(p.name, 60)}${p.active ? ' ✅' : ''}\n-# Changes save as you pick them.${p.active ? ' This preset is applied.' : ''}`))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://preview.png')))
    .addActionRowComponents(select(id, 'theme', 'Theme', ['Dark', 'Light'].map(t => ({ label: `${t} theme`, value: t, default: s.theme === t }))))
    .addActionRowComponents(select(id, 'font', 'Font', qp.QUOTE_FONTS.map(f => ({ label: f, value: f, default: s.font === f }))))
    .addActionRowComponents(select(id, 'avatar', 'Avatar', [{ label: 'Black & white avatar', value: 'gray', default: s.grayscale }, { label: 'Colour avatar', value: 'color', default: !s.grayscale }]))
    .addActionRowComponents(select(id, 'handle', '@handle', [{ label: 'Show @handle', value: 'show', default: s.showHandle }, { label: 'Hide @handle', value: 'hide', default: !s.showHandle }]))
    .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`qp:${id}:apply`).setLabel(p.active ? 'Applied' : 'Apply this preset').setStyle(ButtonStyle.Success).setDisabled(p.active)));
  return { flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [box], files: [file], allowedMentions: { parse: [] as never[] } };
}

async function openEditor(i: ChatInputCommandInteraction, p: qp.Preset) {
  for (const [k, v] of editors) if (Date.now() - v.at > TTL) editors.delete(k);
  const id = randomBytes(6).toString('hex');
  editors.set(id, { owner: i.user.id, name: p.name, at: Date.now() });
  await i.editReply(await editorPayload(id, i.user, p) as never);
}

const priv = (fn: (i: ChatInputCommandInteraction) => Promise<unknown>) => async (i: ChatInputCommandInteraction) => {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  try { await fn(i); } catch (e) { await i.editReply(card({ title: '❌ Couldn\'t do that', color: 0xed4245, description: e instanceof qp.PresetError ? e.message : 'Something went wrong.' })); }
};

async function presetAutocomplete(i: AutocompleteInteraction) {
  const q = String(i.options.getFocused()).toLowerCase();
  await i.respond((await qp.listPresets(i.user.id)).filter(p => p.name.toLowerCase().includes(q)).slice(0, 25).map(p => ({ name: `${p.name}${p.active ? ' (applied)' : ''}`, value: p.name })));
}
const named = async (i: ChatInputCommandInteraction) => {
  const p = await qp.getPreset(i.user.id, i.options.getString('preset', true));
  if (!p) throw new qp.PresetError('You don\'t have a preset with that name — see `/quotemessage config list`.');
  return p;
};
const pick = { tweaks: { preset: { autocomplete: true, maxLength: qp.MAX_PRESET_NAME } }, autocomplete: presetAutocomplete };

const config = [
  hsub('quotemessage config create', priv(async i => openEditor(i, await qp.createPreset(i.user.id, i.options.getString('name', true)))), { tweaks: { name: { maxLength: qp.MAX_PRESET_NAME } } }),
  hsub('quotemessage config edit', priv(async i => openEditor(i, await named(i))), pick),
  hsub('quotemessage config delete', priv(async i => {
    const p = await named(i);
    await qp.deletePreset(i.user.id, p.name);
    await i.editReply(card({ title: '🗑️ Preset deleted', color: COLOR, description: `**${trunc(p.name, 60)}** is gone.${p.active ? ' Your quotes are back to the classic look.' : ''}` }));
  }), pick),
  hsub('quotemessage config apply', priv(async i => {
    const p = await named(i);
    await qp.applyPreset(i.user.id, p.name);
    await i.editReply(card({ title: '✅ Preset applied', color: COLOR, description: `Your quotes now use **${trunc(p.name, 60)}**.` }));
  }), pick),
  hsub('quotemessage config list', priv(async i => {
    const list = await qp.listPresets(i.user.id);
    const line = (p: qp.Preset) => `${p.active ? '✅' : '•'} **${trunc(p.name, 60)}** — ${p.style.theme}, ${p.style.font}, ${p.style.grayscale ? 'B&W' : 'colour'} avatar${p.style.showHandle ? '' : ', no @handle'}`;
    await i.editReply(card({ title: '🎨 Your quote presets', color: COLOR, description: list.length ? `${list.map(line).join('\n')}\n\n-# ${list.length}/${qp.MAX_PRESETS} presets` : 'You have no presets yet — make one with `/quotemessage config create`.' }));
  })),
];

const howto = hsub('quotemessage howto', async i => {
  await i.reply({ ...card({
    title: '💬 How to quote a message', color: COLOR,
    description: [
      '**1.** Right-click a message (on mobile: press and hold it).',
      '**2.** Pick **Apps → Quote Message**.',
      '**3.** The quote is posted with a button to remove it.',
      '',
      'Make it yours with presets: `/quotemessage config create` a preset, style it in the editor, then **Apply** it. Your applied preset is used for every quote you make, and for `/generate fake quote`.',
    ].join('\n'),
  }), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral } as never);
});

onComponent('qp:', async c => {
  const [, id, part] = c.customId.split(':');
  const ed = editors.get(id!);
  if (!ed) { await c.reply({ content: 'This editor has expired — run `/quotemessage config edit` again.', flags: MessageFlags.Ephemeral }); return; }
  if (ed.owner !== c.user.id) { await c.reply({ content: 'That editor isn\'t yours.', flags: MessageFlags.Ephemeral }); return; }
  ed.at = Date.now();
  await c.deferUpdate();
  try {
    let p: qp.Preset | null;
    if (c.isButton() && part === 'apply') { await qp.applyPreset(c.user.id, ed.name); p = await qp.getPreset(c.user.id, ed.name); }
    else if (c.isStringSelectMenu()) {
      const v = c.values[0]!;
      const patch: Partial<QuoteStyle> = part === 'theme' ? { theme: v as QuoteStyle['theme'] } : part === 'font' ? { font: v as QuoteStyle['font'] } : part === 'avatar' ? { grayscale: v === 'gray' } : { showHandle: v === 'show' };
      p = await qp.updatePreset(c.user.id, ed.name, patch);
    } else return;
    if (!p) throw new qp.PresetError('That preset doesn\'t exist any more.');
    await c.editReply(await editorPayload(id!, c.user, p) as never);
  } catch (e) {
    await c.followUp({ content: `❌ ${e instanceof qp.PresetError ? e.message : 'Couldn\'t save that.'}`, flags: MessageFlags.Ephemeral });
  }
});

export default hgroup({ name: 'quotemessage', subs: [howto], groups: [{ name: 'config', description: 'Your quote presets', subs: config }] });
