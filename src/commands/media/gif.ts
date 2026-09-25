import { hleaf } from '../../framework/heist.js';
import { download, findMedia, mediaHandler, sendFile, withWorkdir } from '../../framework/media.js';
import * as fx from '../../media/effects.js';

/** Shortcut for /media image togif. */
export default hleaf('gif', mediaHandler(async i => {
  await withWorkdir(async dir => {
    const file = await download(await findMedia(i, 'image'), dir);
    const out = await fx.toGif(await fx.makeJob(dir, file));
    await sendFile(i, dir, out.file, { name: out.name });
  });
}));
