import { hleaf } from '../../framework/heist.js';
import { mediaHandler } from '../../framework/media.js';
import { recognizedCard } from '../../music/cards.js';
import { recognize } from '../../music/recognize.js';

export default hleaf('shazam', mediaHandler(async i => {
  const a = i.options.getAttachment('audio', true);
  await i.editReply(recognizedCard(await recognize({ url: a.url, name: a.name, contentType: a.contentType })));
}));
