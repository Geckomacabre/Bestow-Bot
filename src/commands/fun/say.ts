import { MessageFlags } from 'discord.js';
import { hleaf } from '../../framework/heist.js';
import { freaky, reverse, uwu } from '../../fun/textstyles.js';

export default hleaf('say', async i => {
  let text = i.options.getString('message', true);
  if (i.options.getBoolean('uwu')) text = uwu(text);
  if (i.options.getBoolean('freaky')) text = freaky(text);
  if (i.options.getBoolean('reverse')) text = reverse(text);
  if (text.length > 2000) { await i.reply({ content: '❌ That came out longer than 2000 characters.', flags: MessageFlags.Ephemeral }); return; }
  await i.reply({ content: text, allowedMentions: { parse: [] } });
}, { tweaks: { message: { maxLength: 1000 } } });
