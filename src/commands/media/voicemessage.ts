import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AttachmentBuilder } from 'discord.js';
import { hleaf } from '../../framework/heist.js';
import { MediaError, download, ffmpeg, mediaHandler, probe, withWorkdir } from '../../framework/media.js';
import { makeVoiceMessage, sendVoiceMessage } from '../../framework/voicemessage.js';

/** Turns an audio (or video) file into a real Discord voice message, optionally trimmed to `duration` seconds. */
export default hleaf('voicemessage', mediaHandler(async i => {
  const att = i.options.getAttachment('audio', true);
  if (att.contentType && !/^(audio|video)\//.test(att.contentType)) throw new MediaError('That isn\'t an audio or video file.');
  const seconds = i.options.getInteger('duration');
  const audio = await withWorkdir(async dir => {
    const file = await download({ url: att.url, name: att.name, contentType: att.contentType }, dir);
    const info = await probe(file, dir);
    if (!info.hasAudio) throw new MediaError('That file has no sound in it.');
    await ffmpeg(['-i', file, ...(seconds ? ['-t', String(seconds)] : ['-t', '600']), '-vn', '-ac', '1', '-b:a', '96k', 'clip.mp3'], { cwd: dir });
    return readFile(path.join(dir, 'clip.mp3'));
  });
  const vm = await makeVoiceMessage(audio, 'mp3');
  if (await sendVoiceMessage(i, vm)) { await i.deleteReply().catch(() => {}); return; }
  // Discord only allows voice messages where the bot can post in the channel; elsewhere, send the audio as a normal file.
  await i.editReply({ content: '🎙️ I can\'t post voice messages here, so here\'s the audio as a file.', files: [new AttachmentBuilder(vm.ogg, { name: 'voice-message.ogg' })] });
}), { tweaks: { duration: { min: 1, max: 600 } } });
