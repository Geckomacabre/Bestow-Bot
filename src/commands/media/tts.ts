import { AttachmentBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { hleaf } from '../../framework/heist.js';
import { MAX_TEXT, cleanForSpeech, findVoice, speak, ttsCooldown, voiceIcon } from '../../services/tts.js';
import { MAX_WORDS, singLite } from '../../services/singlite.js';
import { MediaError, mediaHandler, uploadLimit } from '../../framework/media.js';
import { makeVoiceMessage, sendVoiceMessage } from '../../framework/voicemessage.js';

/** Heist's /tts voices → Bestow's voices (Kokoro speech, effect-chain characters, and the instant sing-song melodies). */
export const HEIST_VOICES: Record<string, string> = {
  'Female': 'af_heart', 'Male': 'am_michael', 'Male 2': 'am_adam',
  'Ghostface (Char)': 'char:masked', 'Stormtrooper (Char)': 'char:trooper', 'Rocket (Char)': 'char:rascal',
  'Tenor (Singing)': 'sing:tenor', 'Sunshine Soon (Singing)': 'sing:sunshine', 'Warmy Breeze (Singing)': 'sing:breeze', 'Glorious (Singing)': 'sing:glorious',
  'It Goes Up (Singing)': 'sing:goesup', 'Chipmunk (Singing)': 'sing:chipmunk', 'Dramatic (Singing)': 'sing:dramatic',
};

const SING_COOLDOWN_LITE_MS = 12_000;
const liteLast = new Map<string, number>();
function liteCooldown(userId: string, now = Date.now()): number {
  const wait = (liteLast.get(userId) ?? 0) + SING_COOLDOWN_LITE_MS - now;
  if (wait > 0) return wait;
  liteLast.set(userId, now);
  return 0;
}

async function sendAudio(i: ChatInputCommandInteraction, mp3: Buffer, name: string, content: string) {
  if (mp3.length > uploadLimit(i)) throw new MediaError('The audio came out larger than this server\'s upload limit — try shorter text.');
  if (i.options.getBoolean('voicemessage')) {
    // A voice message is a separate bot message with a waveform; if Discord won't take it, fall back to a normal attachment.
    const vm = await makeVoiceMessage(mp3).catch(() => null);
    if (vm && (await sendVoiceMessage(i, vm))) { await i.deleteReply().catch(() => {}); return; }
    content += '\n*(couldn\'t send as a voice message here — attached the audio instead)*';
  }
  await i.editReply({ content, files: [new AttachmentBuilder(mp3, { name })] });
}

export default hleaf('tts', mediaHandler(async i => {
  const raw = i.options.getString('text', true);
  const choice = i.options.getString('voice') ?? 'Female';
  const voice = findVoice(HEIST_VOICES[choice] ?? choice);
  if (!voice) throw new MediaError('I don\'t know that voice.');

  const wait = voice.engine === 'sing' ? liteCooldown(i.user.id) : ttsCooldown(i.user.id);
  if (wait > 0) throw new MediaError(`Slow down — you can use /tts again in ${Math.ceil(wait / 1000)}s.`);

  if (voice.engine === 'sing') {
    const r = await singLite(cleanForSpeech(raw).slice(0, MAX_TEXT), voice.id.replace('sing:', ''));
    await sendAudio(i, r.mp3, 'singing.mp3', `🎵 **${choice}** — ${r.words} word${r.words === 1 ? '' : 's'}, ${r.seconds.toFixed(0)}s${cleanForSpeech(raw).split(/\s+/).length > MAX_WORDS ? ` *(sang the first ${MAX_WORDS} words)*` : ''}`);
    return;
  }
  const r = await speak(raw, voice.id, 1);
  await sendAudio(i, r.mp3, 'speech.mp3', `${voiceIcon(r.voice)} **${choice}**`);
}), { tweaks: { text: { maxLength: 2000 } } });
