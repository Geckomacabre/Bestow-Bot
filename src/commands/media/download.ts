import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AttachmentBuilder } from 'discord.js';
import { hleaf } from '../../framework/heist.js';
import { ffmpeg, mediaHandler, uploadLimit } from '../../framework/media.js';
import * as dl from '../../media/download.js';

const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);

/**
 * Heist's integer choices: quality 144p…1080p → 144…1080; audio "With Audio" = 0, "Muted" = 1; format "Audio Only" = 0, "Video" = 1.
 */
export default hleaf('download', mediaHandler(async i => {
  const audioOnly = i.options.getInteger('format') === 0;
  const muted = !audioOnly && i.options.getInteger('audio') === 1;
  const height = i.options.getInteger('quality') ?? 720;
  const mode: dl.Mode = audioOnly ? 'audio' : 'video';
  await dl.downloadMedia(i.options.getString('url', true), { mode, maxHeight: height, maxBytes: Math.floor(uploadLimit(i) * 0.98) }, async d => {
    let data: Buffer;
    if (muted) {
      const dir = path.dirname(d.file);
      await ffmpeg(['-i', path.basename(d.file), '-an', '-c:v', 'copy', 'muted.mp4'], { cwd: dir });
      data = await readFile(path.join(dir, 'muted.mp4'));
    } else data = await readFile(d.file);
    const label = mode === 'audio' ? 'Audio' : `Video${d.height ? ` (up to ${d.height}p)` : ''}${muted ? ' · muted' : ''}`;
    await i.editReply({ content: `📥 ${label} · ${fmtSize(data.length)}`, files: [new AttachmentBuilder(data, { name: muted ? 'download.mp4' : d.name })], components: [] });
  });
}), { tweaks: { url: { maxLength: 500 } } });
