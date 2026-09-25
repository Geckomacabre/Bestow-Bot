import { AttachmentBuilder, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, TextDisplayBuilder, type User } from 'discord.js';
import { createCanvas } from '@napi-rs/canvas';
import { safeLoadImage } from '../../framework/imgsafe.js';
import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import type { Sub } from '../../framework/group.js';
import { db } from '../../utils/db.js';
import { IS_CV2 } from '../../utils/components.js';
import { getBufferPublic } from '../../framework/http.js';
import { getWallet } from '../../eco/core.js';
import { BUSINESSES } from '../../eco/catalog.js';
import {
  AVATAR_SHAPES, DEFAULT_STYLE, ensureWalletBgDir, normHex, renderWalletCard, walletBgPath,
  type AvatarShape, type WalletStyle,
} from '../../eco/render.js';
import { Colors, cv2Box, cv2Err, ecoCtx } from './ui.js';

export const MESSAGE_MAX = 100;

export async function getWalletStyle(userId: string): Promise<WalletStyle> {
  const [r] = await db`SELECT * FROM eco_wallet_style WHERE user_id = ${userId}`;
  if (!r) return { ...DEFAULT_STYLE };
  return {
    avatarShape: (r.avatar_shape as AvatarShape) ?? 'circle',
    bgColor: r.bg_color as string | null,
    bgColor2: r.bg_color2 as string | null,
    bgDirection: (r.bg_direction as WalletStyle['bgDirection']) ?? 'horizontal',
    hasBgImage: !!r.has_bg_image,
    opacity: r.opacity as number,
    textColor: r.text_color as string | null,
    message: r.message as string | null,
    hideWallet: !!r.hide_wallet,
  };
}

export async function setStyle(userId: string, patch: Record<string, string | number | null>): Promise<void> {
  await db`INSERT OR IGNORE INTO eco_wallet_style (user_id) VALUES (${userId})`;
  for (const [col, val] of Object.entries(patch)) {
    if (!/^[a-z_0-9]+$/.test(col)) throw new Error('bad column');
    await db.unsafe(`UPDATE eco_wallet_style SET ${col} = ? WHERE user_id = ?`, [val, userId]);
  }
}

/** Forgets every card setting (and the uploaded background, if any). */
export async function resetStyle(userId: string): Promise<void> {
  const p = walletBgPath(userId);
  if (existsSync(p)) unlinkSync(p);
  await db`DELETE FROM eco_wallet_style WHERE user_id = ${userId}`;
}

/** The wallet card for `target`. `hidden` blanks the balances (their privacy setting, when someone else is looking). */
export async function walletCardPng(target: Pick<User, 'id' | 'username' | 'displayName' | 'displayAvatarURL'>, guildId: string, sym: string, opts: { hidden?: boolean; style?: WalletStyle } = {}): Promise<{ png: Buffer; hidden: boolean }> {
  const [w, style] = await Promise.all([getWallet(guildId, target.id), opts.style ? Promise.resolve(opts.style) : getWalletStyle(target.id)]);
  const [lab] = await db`SELECT level FROM eco_lab WHERE user_id = ${target.id}`;
  const [co] = await db`SELECT c.tag FROM eco_company_member m JOIN eco_company c ON c.id = m.company_id WHERE m.user_id = ${target.id}`;
  const hidden = opts.hidden ?? false;
  const png = await renderWalletCard({
    userId: target.id,
    username: target.displayName ?? target.username,
    avatarUrl: target.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }),
    currencySymbol: sym,
    cash: w.cash, bank: w.bank, bankCap: w.bankCap, networth: w.networth,
    businessName: w.business ? BUSINESSES[w.business.kind]?.name ?? null : null,
    labLevel: (lab?.level as number) ?? null,
    companyTag: (co?.tag as string) ?? null,
    style, hidden,
  });
  return { png, hidden };
}

export const walletView: Sub = {
  name: 'wallet',
  description: 'View your wallet card (or someone else\'s)',
  options: s => s.addUserOption(o => o.setName('user').setDescription('Whose wallet (default: you)')),
  async run(interaction) {
    await interaction.deferReply();
    const ctx = await ecoCtx(interaction);
    const target = interaction.options.getUser('user') ?? interaction.user;
    if (target.bot) { await interaction.editReply(cv2Err('Bots don\'t have wallets.')); return; }

    const style = await getWalletStyle(target.id);
    const hidden = style.hideWallet && target.id !== interaction.user.id;
    const { png } = await walletCardPng(target, ctx.guildId, ctx.sym, { hidden, style });
    const w = await getWallet(ctx.guildId, target.id);

    const container = new ContainerBuilder().setAccentColor(Colors.Gold)
      .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://wallet.png')));
    if (!hidden) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `**${ctx.name}** — cash ${ctx.fmt(w.cash)} · bank ${ctx.fmt(w.bank)}/${w.bankCap.toLocaleString()} · net worth **${ctx.fmt(w.networth)}**`,
      ));
    }
    await interaction.editReply({ flags: IS_CV2, files: [new AttachmentBuilder(png, { name: 'wallet.png' })], components: [container] });
  },
};

// ─── Wallet customisation: /eco wallet-edit ──────────────────────────────────

/** Sets the colour(s) of the card background from `#hex` inputs; `gradient` of "none" removes the second colour. Returns an error message or null. */
export function backgroundPatch(o: { color?: string | null; gradient?: string | null; direction?: string | null }): { patch: Record<string, string | number | null>; error?: string } {
  const patch: Record<string, string | number | null> = {};
  if (o.color) { const c = normHex(o.color); if (!c) return { patch, error: '`color` must be a hex code like `#1a1a2e`.' }; patch.bg_color = c; }
  if (o.gradient) {
    if (o.gradient.trim().toLowerCase() === 'none') patch.bg_color2 = null;
    else { const c = normHex(o.gradient); if (!c) return { patch, error: '`gradient` must be a hex code like `#4dd0e1`, or `none`.' }; patch.bg_color2 = c; }
  }
  if (o.direction) patch.bg_direction = o.direction;
  return { patch };
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export const walletEditSubs: Sub[] = [
  {
    name: 'avatar', description: 'Change the avatar shape',
    options: s => s.addStringOption(o => o.setName('shape').setDescription('Avatar shape').setRequired(true)
      .addChoices(...AVATAR_SHAPES.map(v => ({ name: cap(v), value: v })))),
    async run(i) {
      const shape = i.options.getString('shape', true);
      await setStyle(i.user.id, { avatar_shape: shape });
      await i.reply(cv2Box(`✅ Avatar shape set to **${shape}**. See it with \`/eco wallet\`.`, Colors.Green));
    },
  },
  {
    name: 'background', description: 'Change the card background',
    options: s => s
      .addStringOption(o => o.setName('color').setDescription('Solid color or top gradient color, such as #111827'))
      .addStringOption(o => o.setName('gradient').setDescription("Bottom gradient color, or 'none' to disable it"))
      .addStringOption(o => o.setName('direction').setDescription('Where the first gradient color starts')
        .addChoices({ name: 'Horizontal', value: 'horizontal' }, { name: 'Vertical', value: 'vertical' }, { name: 'Diagonal', value: 'diagonal' }))
      .addAttachmentOption(o => o.setName('image').setDescription('Image to stretch to the card dimensions'))
      .addBooleanOption(o => o.setName('remove_image').setDescription('Remove the uploaded image and use colors instead')),
    async run(i) {
      const image = i.options.getAttachment('image');
      const removeImage = i.options.getBoolean('remove_image');
      const { patch, error } = backgroundPatch({ color: i.options.getString('color'), gradient: i.options.getString('gradient'), direction: i.options.getString('direction') });
      if (error) { await i.reply(cv2Err(error)); return; }
      if (!Object.keys(patch).length && !image && !removeImage) {
        await i.reply(cv2Err('Give me something to change: `color`, `gradient`, `direction`, `image` or `remove_image`.')); return;
      }
      if (removeImage) {
        const p = walletBgPath(i.user.id);
        if (existsSync(p)) unlinkSync(p);
        patch.has_bg_image = 0;
      }
      if (image) {
        if (!image.contentType?.startsWith('image/')) { await i.reply(cv2Err('That attachment isn\'t an image.')); return; }
        if (image.size > 8 * 1024 * 1024) { await i.reply(cv2Err('Image too large (8 MB max).')); return; }
        await i.deferReply();
        try {
          const raw = await getBufferPublic(image.url, { maxBytes: 8 * 1024 * 1024 });
          const img = await safeLoadImage(raw, { maxSide: 1600 }); // user-supplied bytes: see framework/imgsafe.ts
          // Store a cover-cropped 800×280 copy so rendering is cheap and the file is small.
          const c = createCanvas(800, 280);
          const ctx = c.getContext('2d');
          const s = Math.max(800 / img.width, 280 / img.height);
          ctx.drawImage(img, (800 - img.width * s) / 2, (280 - img.height * s) / 2, img.width * s, img.height * s);
          ensureWalletBgDir();
          writeFileSync(walletBgPath(i.user.id), c.toBuffer('image/png'));
          patch.has_bg_image = 1;
        } catch {
          await i.editReply(cv2Err('I couldn\'t read that image. Try a PNG or JPG under 8 MB.')); return;
        }
        await setStyle(i.user.id, patch);
        await i.editReply(cv2Box('✅ Wallet background updated. See it with `/eco wallet`.', Colors.Green));
        return;
      }
      await setStyle(i.user.id, patch);
      await i.reply(cv2Box('✅ Wallet background updated. See it with `/eco wallet`.', Colors.Green));
    },
  },
  {
    name: 'message', description: 'Set or clear the card message',
    options: s => s.addStringOption(o => o.setName('text').setDescription(`Message up to ${MESSAGE_MAX} characters; use '-' to clear it`).setRequired(true).setMaxLength(MESSAGE_MAX)),
    async run(i) {
      const raw = i.options.getString('text', true).trim();
      const text = raw === '-' || raw === '' ? null : raw;
      await setStyle(i.user.id, { message: text });
      await i.reply({ ...cv2Box(text ? `✅ Wallet message set to “${text}”.` : '✅ Wallet message cleared.', Colors.Green), allowedMentions: { parse: [] } });
    },
  },
  {
    name: 'opacity', description: 'Change the dark overlay opacity',
    options: s => s.addIntegerOption(o => o.setName('amount').setDescription('Dark overlay opacity from 0 to 90 percent').setRequired(true).setMinValue(0).setMaxValue(90)),
    async run(i) {
      const v = i.options.getInteger('amount', true);
      await setStyle(i.user.id, { opacity: v / 100 });
      await i.reply(cv2Box(`✅ Overlay opacity set to **${v}%**.`, Colors.Green));
    },
  },
  {
    name: 'privacy', description: 'Show or hide cash and net worth',
    options: s => s.addBooleanOption(o => o.setName('hide_wallet').setDescription('Hide cash and net worth when enabled').setRequired(true)),
    async run(i) {
      const hide = i.options.getBoolean('hide_wallet', true);
      await setStyle(i.user.id, { hide_wallet: hide ? 1 : 0 });
      await i.reply(cv2Box(hide ? '🔒 Others will no longer see your balances on your wallet card, history or graph.' : '🔓 Your wallet card is public again.', Colors.Green));
    },
  },
  {
    name: 'text-color', description: 'Change the card text color',
    options: s => s.addStringOption(o => o.setName('color').setDescription('Six-digit hex color, such as #F8FAFC').setRequired(true)),
    async run(i) {
      const c = normHex(i.options.getString('color', true));
      if (!c) { await i.reply(cv2Err('That isn\'t a hex colour like `#ffd166`.')); return; }
      await setStyle(i.user.id, { text_color: c });
      await i.reply(cv2Box(`✅ Text colour set to **${c}**.`, Colors.Green));
    },
  },
  {
    name: 'reset', description: 'Reset every balance-card setting',
    async run(i) {
      await resetStyle(i.user.id);
      await i.reply(cv2Box('✅ Your wallet card is back to the defaults.', Colors.Green));
    },
  },
];
