import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, ModalBuilder,
  SeparatorBuilder, SeparatorSpacingSize, StringSelectMenuBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction, type User,
} from 'discord.js';
import type { Sub } from '../../framework/group.js';
import { getEconomyConfig } from '../../utils/db.js';
import { premiumOf } from '../../premium/index.js';
import { gateActive } from '../../premium/wall.js';
import { AVATAR_SHAPES, normHex, type AvatarShape, type WalletStyle } from '../../eco/render.js';
import { MESSAGE_MAX, backgroundPatch, getWalletStyle, resetStyle, setStyle, walletCardPng } from './wallet.js';

/**
 * `/eco wallet-edit studio`: one message with a live preview of the card and controls to restyle it.
 * Every control's custom id carries the owner's id (`ws:<userId>:<action>`), and only the owner can use them.
 */

export interface Preset { id: string; label: string; from: string; to: string; text: string }
export const PRESETS: Preset[] = [
  { id: 'midnight', label: 'Midnight', from: '#0d0d1a', to: '#1a1a2e', text: '#ffffff' },
  { id: 'ocean', label: 'Ocean', from: '#0f2027', to: '#2c5364', text: '#4dd0e1' },
  { id: 'sunset', label: 'Sunset', from: '#ff512f', to: '#dd2476', text: '#ffffff' },
  { id: 'forest', label: 'Forest', from: '#134e5e', to: '#71b280', text: '#e8ffe8' },
  { id: 'royal', label: 'Royal', from: '#41295a', to: '#2f0743', text: '#ffd166' },
  { id: 'graphite', label: 'Graphite', from: '#232526', to: '#414345', text: '#f8fafc' },
];

export type StudioAction = 'shape' | 'preset' | 'darker' | 'lighter' | 'privacy' | 'reset';
const STEP = 0.1;

/** Applies one studio control to a person's saved style. Returns false for a value it doesn't recognise. */
export async function applyStudioAction(userId: string, action: StudioAction, value?: string): Promise<boolean> {
  const style = await getWalletStyle(userId);
  switch (action) {
    case 'shape':
      if (!AVATAR_SHAPES.includes(value as AvatarShape)) return false;
      await setStyle(userId, { avatar_shape: value! }); return true;
    case 'preset': {
      const p = PRESETS.find(x => x.id === value);
      if (!p) return false;
      await setStyle(userId, { bg_color: p.from, bg_color2: p.to, text_color: p.text, bg_direction: 'diagonal', has_bg_image: 0 }); return true;
    }
    case 'darker': await setStyle(userId, { opacity: Math.min(0.9, Math.round((style.opacity + STEP) * 100) / 100) }); return true;
    case 'lighter': await setStyle(userId, { opacity: Math.max(0, Math.round((style.opacity - STEP) * 100) / 100) }); return true;
    case 'privacy': await setStyle(userId, { hide_wallet: style.hideWallet ? 0 : 1 }); return true;
    case 'reset': await resetStyle(userId); return true;
  }
}

/** Applies the "custom colours" form. Returns an error message, or null when it saved. */
export async function applyColorsForm(userId: string, f: { bg?: string; gradient?: string; text?: string; message?: string }): Promise<string | null> {
  const { patch, error } = backgroundPatch({ color: f.bg?.trim() || null, gradient: f.gradient?.trim() || null });
  if (error) return error;
  if (f.text?.trim()) { const c = normHex(f.text); if (!c) return '`text` must be a hex code like `#f8fafc`.'; patch.text_color = c; }
  if (f.message !== undefined && f.message.trim() !== '') patch.message = f.message.trim() === '-' ? null : f.message.trim().slice(0, MESSAGE_MAX);
  if (!Object.keys(patch).length) return 'Fill in at least one box.';
  await setStyle(userId, patch);
  return null;
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

function settingsText(s: WalletStyle): string {
  return [
    `**Avatar** ${cap(s.avatarShape)}`,
    `**Overlay** ${Math.round(s.opacity * 100)}%`,
    `**Privacy** ${s.hideWallet ? '🔒 hidden from others' : '🔓 public'}`,
    `**Colours** ${s.hasBgImage ? 'custom image' : `${s.bgColor ?? 'default'}${s.bgColor2 ? ` → ${s.bgColor2}` : ''}`}${s.textColor ? ` · text ${s.textColor}` : ''}`,
    s.message ? `**Message** “${s.message}”` : null,
  ].filter(Boolean).join('\n');
}

const id = (userId: string, action: string) => `ws:${userId}:${action}`;

/** The whole studio message for `user`: preview, settings summary and controls. */
export async function studioView(user: Pick<User, 'id' | 'username' | 'displayName' | 'displayAvatarURL'>, guildId: string) {
  const [style, cfg] = await Promise.all([getWalletStyle(user.id), getEconomyConfig(guildId)]);
  const { png } = await walletCardPng(user, guildId, cfg.currency_symbol, { style });
  const name = `wallet-${Date.now()}.png`;
  const shapes = new StringSelectMenuBuilder().setCustomId(id(user.id, 'shape')).setPlaceholder('Avatar shape')
    .addOptions(AVATAR_SHAPES.map(v => ({ label: cap(v), value: v, default: v === style.avatarShape })));
  const presets = new StringSelectMenuBuilder().setCustomId(id(user.id, 'preset')).setPlaceholder('Colour theme')
    .addOptions(PRESETS.map(p => ({ label: p.label, value: p.id, description: `${p.from} → ${p.to}` })));
  const button = (action: string, label: string, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id(user.id, action)).setLabel(label).setStyle(style);
  const c = new ContainerBuilder().setAccentColor(0xffd166)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('## 🎨 Balance card studio'))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`)))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${settingsText(style)}\n-# Changes save instantly. Only you can use these controls.`))
    .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(shapes))
    .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(presets))
    .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      button('colors', 'Custom colours & message', ButtonStyle.Primary), button('darker', 'Darker'), button('lighter', 'Lighter'),
      button('privacy', style.hideWallet ? 'Make public' : 'Hide balances'), button('reset', 'Reset', ButtonStyle.Danger)));
  return { flags: MessageFlags.IsComponentsV2 as const, files: [new AttachmentBuilder(png, { name })], components: [c], attachments: [], allowedMentions: { parse: [] as never[] } };
}

export const studioSub: Sub = {
  name: 'studio', description: 'Open the interactive balance-card studio',
  async run(i) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    await i.editReply(await studioView(i.user, i.guildId ?? 'global'));
  },
};

// ─── Component handlers ──────────────────────────────────────────────────────

const say = (content: string) => ({ content, flags: MessageFlags.Ephemeral as const });

/** Checks the click is from the owner (and still has Premium once Premium is on sale). Returns the owner's id, or null after replying. */
async function authorize(i: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction): Promise<string | null> {
  const [, owner] = i.customId.split(':');
  if (owner !== i.user.id) { await i.reply(say('This studio belongs to someone else — open your own with `/eco wallet-edit studio`.')); return null; }
  if (gateActive() && !(await premiumOf(i)).premium) { await i.reply(say('✨ The studio is part of Bestow Premium — see `/premium buy`.')); return null; }
  return owner;
}

async function refresh(i: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction) {
  await i.editReply(await studioView(i.user, i.guildId ?? 'global'));
}

export async function handleStudioComponent(i: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
  const owner = await authorize(i); if (!owner) return;
  const action = i.customId.split(':')[2] as string;
  if (action === 'colors') {
    const s = await getWalletStyle(owner);
    const field = (idn: string, label: string, ph: string, value: string | null, max = 32) => {
      const input = new TextInputBuilder().setCustomId(idn).setLabel(label).setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder(ph).setMaxLength(max);
      if (value) input.setValue(value); // Discord rejects an empty pre-filled value
      return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
    };
    await i.showModal(new ModalBuilder().setCustomId(id(owner, 'modal')).setTitle('Custom colours & message').addComponents(
      field('bg', 'Background colour (hex)', '#111827', s.bgColor),
      field('gradient', "Second colour (hex, or 'none')", '#1f2937', s.bgColor2),
      field('text', 'Text colour (hex)', '#f8fafc', s.textColor),
      field('message', "Message (or '-' to clear)", 'Saving for something big', s.message, MESSAGE_MAX),
    ));
    return;
  }
  await i.deferUpdate();
  const value = i.isStringSelectMenu() ? i.values[0] : undefined;
  if (!['shape', 'preset', 'darker', 'lighter', 'privacy', 'reset'].includes(action) || !(await applyStudioAction(owner, action as StudioAction, value))) {
    await i.followUp(say('I don\'t know that control any more — reopen the studio.')); return;
  }
  await refresh(i);
}

export async function handleStudioModal(i: ModalSubmitInteraction): Promise<void> {
  const owner = await authorize(i); if (!owner) return;
  const get = (k: string) => i.fields.getTextInputValue(k);
  const error = await applyColorsForm(owner, { bg: get('bg'), gradient: get('gradient'), text: get('text'), message: get('message') });
  if (error) { await i.reply(say(`❌ ${error}`)); return; }
  if (i.isFromMessage()) await i.deferUpdate(); else await i.deferReply({ flags: MessageFlags.Ephemeral });
  await refresh(i);
}
