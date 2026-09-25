import { messageMenu } from '../../framework/menu.js';
import { MediaError } from '../../framework/media.js';
import { recognizedCard } from '../../music/cards.js';
import { recognize } from '../../music/recognize.js';
import { friendlyError } from '../../lookups/handler.js';
import { cv2Err } from '../../utils/components.js';

/** Right-click a message with audio or video → Apps → Identify Song. */
export default messageMenu('Identify Song', async i => {
  const m = i.targetMessage;
  const att = m.attachments.find(a => /^(audio|video)\//.test(a.contentType ?? '')) ?? null;
  const embedVideo = m.embeds.find(e => e.video?.url)?.video?.url;
  if (!att && !embedVideo) { await i.reply(cv2Err('❌ That message has no audio or video to listen to.')); return; }
  await i.deferReply();
  try {
    await i.editReply(recognizedCard(await recognize(att ? { url: att.url, name: att.name, contentType: att.contentType } : { url: embedVideo!, name: 'video.mp4', contentType: null })));
  } catch (e) {
    await i.editReply(cv2Err(`❌ ${e instanceof MediaError ? e.message : friendlyError(e)}`)).catch(() => {});
  }
});
