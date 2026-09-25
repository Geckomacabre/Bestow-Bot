import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { hgroup, hsub } from '../../framework/heist.js';
import { cv2Box, cv2Err } from '../../utils/components.js';

/** Strict base64 (standard or URL-safe alphabet, optional padding). Buffer.from() silently skips junk, so check first. */
export function decodeBase64(s: string): string | null {
  const t = s.trim().replace(/\s+/g, '');
  if (!t || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(t) || t.replace(/=+$/, '').length % 4 === 1) return null;
  const out = Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return out.includes('�') ? null : out;
}

const block = (s: string) => `\`\`\`\n${s.replace(/```/g, '`​``').slice(0, 1900)}\n\`\`\``;

async function reply(i: ChatInputCommandInteraction, title: string, body: string) {
  await i.reply({ ...cv2Box(`**${title}**\n${block(body)}`, 0x5865f2), allowedMentions: { parse: [] } });
}

export default hgroup({
  name: 'base64',
  subs: [
    hsub('base64 encode', i => reply(i, 'Base64 encoded', Buffer.from(i.options.getString('string', true), 'utf8').toString('base64')), { tweaks: { string: { maxLength: 1400 } } }),
    hsub('base64 decode', async i => {
      const out = decodeBase64(i.options.getString('string', true));
      if (out == null) { await i.reply({ ...cv2Err('❌ That isn\'t valid Base64 (or it doesn\'t decode to text).'), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }); return; }
      await reply(i, 'Base64 decoded', out || '(empty)');
    }, { tweaks: { string: { maxLength: 4000 } } }),
  ],
});
