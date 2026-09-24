import { AttachmentBuilder, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, TextDisplayBuilder } from 'discord.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import type { Sub } from '../../framework/group.js';
import { db } from '../../utils/db.js';
import { IS_CV2 } from '../../utils/components.js';
import { assertPublicUrl, getBuffer } from '../../framework/http.js';
import { getWallet } from '../../eco/core.js';
import { BUSINESSES } from '../../eco/catalog.js';
import {
  AVATAR_SHAPES, DEFAULT_STYLE, ensureWalletBgDir, normHex, renderWalletCard, walletBgPath,
  type AvatarShape, type WalletStyle,
} from '../../eco/render.js';
import { Colors, cv2Box, cv2Err, ecoCtx } from './ui.js';

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

async function setStyle(userId: string, patch: Record<string, string | number | null>): Promise<void> {
  await db`INSERT OR IGNORE INTO eco_wallet_style (user_id) VALUES (${userId})`;
  for (const [col, val] of Object.entries(patch)) {
    if (!/^[a-z_0-9]+$/.test(col)) throw new Error('bad column');
    await db.unsafe(`UPDATE eco_wallet_style SET ${col} = ? WHERE user_id = ?`, [val, userId]);
  }
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

    const [w, style] = await Promise.all([getWallet(ctx.guildId, target.id), getWalletStyle(target.id)]);
    const [lab] = await db`SELECT level FROM eco_lab WHERE user_id = ${target.id}`;
    const [co] = await db`SELECT c.tag FROM eco_company_member m JOIN eco_company c ON c.id = m.company_id WHERE m.user_id = ${target.id}`;
    const hidden = style.hideWallet && target.id !== interaction.user.id;

    const png = await renderWalletCard({
      userId: target.id,
      username: target.displayName ?? target.username,
      avatarUrl: target.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }),
      currencySymbol: ctx.sym,
      cash: w.cash, bank: w.bank, bankCap: w.bankCap, networth: w.networth,
      businessName: w.business ? BUSINESSES[w.business.kind]?.name ?? null : null,
      labLevel: (lab?.level as number) ?? null,
      companyTag: (co?.tag as string) ?? null,
      style, hidden,
    });

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

// ─── Wallet customisation (top-level /wallet group) ──────────────────────────

export const walletEditSubs: Sub[] = [
  {
    name: 'avatar', description: 'Change the avatar shape on your wallet card',
    options: s => s.addStringOption(o => o.setName('shape').setDescription('Avatar shape').setRequired(true)
      .addChoices(...AVATAR_SHAPES.map(v => ({ name: v, value: v })))),
    async run(i) {
      const shape = i.options.getString('shape', true);
      await setStyle(i.user.id, { avatar_shape: shape });
      await i.reply(cv2Box(`✅ Avatar shape set to **${shape}**. See it with \`/eco wallet\`.`, Colors.Green));
    },
  },
  {
    name: 'background', description: 'Set your wallet background (colour, gradient or an image)',
    options: s => s
      .addStringOption(o => o.setName('color').setDescription('Hex colour, e.g. #1a1a2e'))
      .addStringOption(o => o.setName('gradient').setDescription('Second hex colour for a gradient'))
      .addStringOption(o => o.setName('direction').setDescription('Gradient direction')
        .addChoices({ name: 'Horizontal', value: 'horizontal' }, { name: 'Vertical', value: 'vertical' }, { name: 'Diagonal', value: 'diagonal' }))
      .addAttachmentOption(o => o.setName('image').setDescription('Background image (PNG/JPG/WebP)'))
      .addBooleanOption(o => o.setName('remove_image').setDescription('Remove your current background image')),
    async run(i) {
      const colorIn = i.options.getString('color');
      const gradIn = i.options.getString('gradient');
      const direction = i.options.getString('direction');
      const image = i.options.getAttachment('image');
      const removeImage = i.options.getBoolean('remove_image');
      if (!colorIn && !gradIn && !direction && !image && !removeImage) {
        await i.reply(cv2Err('Give me something to change: `color`, `gradient`, `direction`, `image` or `remove_image`.')); return;
      }
      const patch: Record<string, string | number | null> = {};
      if (colorIn) { const c = normHex(colorIn); if (!c) { await i.reply(cv2Err('`color` must be a hex code like `#1a1a2e`.')); return; } patch.bg_color = c; }
      if (gradIn) { const c = normHex(gradIn); if (!c) { await i.reply(cv2Err('`gradient` must be a hex code like `#4dd0e1`.')); return; } patch.bg_color2 = c; }
      if (direction) patch.bg_direction = direction;

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
          const raw = await getBuffer(assertPublicUrl(image.url).toString(), { maxBytes: 8 * 1024 * 1024 });
          const img = await loadImage(raw);
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
    name: 'message', description: 'Set (or clear) the message shown on your wallet',
    options: s => s.addStringOption(o => o.setName('text').setDescription('Your message (leave empty to clear)').setMaxLength(70)),
    async run(i) {
      const text = i.options.getString('text')?.trim() || null;
      await setStyle(i.user.id, { message: text });
      await i.reply(cv2Box(text ? `✅ Wallet message set to “${text}”.` : '✅ Wallet message cleared.', Colors.Green));
    },
  },
  {
    name: 'opacity', description: 'Change how dark the overlay on your wallet is',
    options: s => s.addIntegerOption(o => o.setName('amount').setDescription('0 (bright) – 90 (dark), default 55').setRequired(true).setMinValue(0).setMaxValue(90)),
    async run(i) {
      const v = i.options.getInteger('amount', true);
      await setStyle(i.user.id, { opacity: v / 100 });
      await i.reply(cv2Box(`✅ Overlay opacity set to **${v}%**.`, Colors.Green));
    },
  },
  {
    name: 'privacy', description: 'Hide your cash and net worth from other people',
    options: s => s.addBooleanOption(o => o.setName('hide_wallet').setDescription('Hide your balances from others').setRequired(true)),
    async run(i) {
      const hide = i.options.getBoolean('hide_wallet', true);
      await setStyle(i.user.id, { hide_wallet: hide ? 1 : 0 });
      await i.reply(cv2Box(hide ? '🔒 Others will no longer see your balances on your wallet card.' : '🔓 Your wallet card is public again.', Colors.Green));
    },
  },
  {
    name: 'text-color', description: 'Change the text and accent colour of your wallet',
    options: s => s.addStringOption(o => o.setName('color').setDescription('Hex colour, e.g. #ffd166').setRequired(true)),
    async run(i) {
      const c = normHex(i.options.getString('color', true));
      if (!c) { await i.reply(cv2Err('That isn\'t a hex colour like `#ffd166`.')); return; }
      await setStyle(i.user.id, { text_color: c });
      await i.reply(cv2Box(`✅ Text colour set to **${c}**.`, Colors.Green));
    },
  },
  {
    name: 'reset', description: 'Reset every wallet card setting',
    async run(i) {
      const p = walletBgPath(i.user.id);
      if (existsSync(p)) unlinkSync(p);
      await db`DELETE FROM eco_wallet_style WHERE user_id = ${i.user.id}`;
      await i.reply(cv2Box('✅ Your wallet card is back to the defaults.', Colors.Green));
    },
  },
];
