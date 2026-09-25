import { MessageFlags, PermissionFlagsBits, Routes, type ChatInputCommandInteraction } from 'discord.js';
import { hgroup, hsub } from '../../framework/heist.js';
import { getBufferPublic } from '../../framework/http.js';
import { cv2Box, cv2Err } from '../../utils/components.js';

/**
 * /serverprofile: the bot's own look in this server only — nickname, avatar, banner and bio — through Discord's
 * "modify current member" endpoint. Server managers only; the bot must be in the server.
 */

const MAX_IMAGE = 10 * 1024 * 1024;
const guard = { guildOnly: true, permissions: PermissionFlagsBits.ManageGuild };
const OK = 0x57f287;

async function patchMe(i: ChatInputCommandInteraction, body: Record<string, string | null>, done: string) {
  if (!i.guild) { await i.reply({ ...cv2Err('❌ I need to be added to this server for that.'), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }); return; }
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await i.client.rest.patch(Routes.guildMember(i.guild.id, '@me'), { body, reason: `Requested by ${i.user.username} (${i.user.id})` });
    await i.editReply(cv2Box(`✅ ${done}`, OK));
  } catch (e) {
    const msg = (e as Error).message ?? '';
    await i.editReply(cv2Err(`❌ Discord refused that${/size|large|too big/i.test(msg) ? ': the image is too large' : /invalid|format/i.test(msg) ? ': that image format isn\'t supported' : ''}.`));
  }
}

async function imageDataUri(i: ChatInputCommandInteraction): Promise<string | null> {
  const a = i.options.getAttachment('image', true);
  if (!/^image\/(png|jpe?g|gif|webp)$/.test(a.contentType ?? '')) { await i.reply({ ...cv2Err('❌ Upload a PNG, JPG, GIF or WEBP image.'), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }); return null; }
  if (a.size > MAX_IMAGE) { await i.reply({ ...cv2Err('❌ That image is over 10 MB.'), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }); return null; }
  const buf = await getBufferPublic(a.url, { maxBytes: MAX_IMAGE });
  return `data:${a.contentType};base64,${buf.toString('base64')}`;
}

const pair = (what: 'avatar' | 'banner' | 'bio' | 'name') => {
  const field = what === 'name' ? 'nick' : what;
  const label = { avatar: 'server avatar', banner: 'server banner', bio: 'server bio', name: 'server nickname' }[what];
  return {
    name: what, description: `The bot's ${label} here`,
    subs: [
      hsub(`serverprofile ${what} reset`, i => patchMe(i, { [field]: null }, `Reset my ${label}.`), guard),
      hsub(`serverprofile ${what} set`, async i => {
        if (!i.guild) { await patchMe(i, {}, ''); return; } // replies with "add me to this server"
        if (what === 'avatar' || what === 'banner') {
          const uri = await imageDataUri(i);
          if (uri) await patchMe(i, { [field]: uri }, `Updated my ${label}.`);
          return;
        }
        const text = i.options.getString('text', true).trim();
        await patchMe(i, { [field]: text || null }, `Set my ${label} to **${text.slice(0, 100)}**.`);
      }, { ...guard, tweaks: { text: { maxLength: what === 'name' ? 32 : 190 } } }),
    ],
  };
};

export default hgroup({ name: 'serverprofile', scope: 'guild', groups: [pair('avatar'), pair('banner'), pair('bio'), pair('name')] });
