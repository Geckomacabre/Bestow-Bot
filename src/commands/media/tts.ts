import {
  ApplicationIntegrationType, AttachmentBuilder, InteractionContextType, SlashCommandBuilder, type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../../interfaces/command';
import {
  ALL_VOICES, MAX_TEXT, SONG_STYLES, TTS_COOLDOWN_MS, cleanForSpeech, ensureElevenVoices, findVoice, searchVoices, speak, speakableLength, ttsCooldown, voiceIcon, type VoiceDef,
} from '../../services/tts.js';
import { freeCharsPerDay, refundChars, reserveChars } from '../../services/elevenlabs.js';
import { premiumConfigured, premiumOf } from '../../premium/index.js';
import { MAX_WORDS, singLite } from '../../services/singlite.js';
import {
  SING_SECONDS, generateSong, queueLength, queuedSong, refundSingCooldown, singCooldown, singHealthy,
} from '../../services/sing.js';
import { ask, llmConfigured, sanitizeReply } from '../../services/llm.js';
import { MediaError, mediaHandler, uploadLimit } from '../../framework/media.js';
import { makeVoiceMessage, sendVoiceMessage } from '../../framework/voicemessage.js';

const SING_COOLDOWN_LITE_MS = 12_000;
const liteLast = new Map<string, number>();
function liteCooldown(userId: string, now = Date.now()): number {
  const wait = (liteLast.get(userId) ?? 0) + SING_COOLDOWN_LITE_MS - now;
  if (wait > 0) return wait;
  liteLast.set(userId, now);
  return 0;
}

const LYRIC_SYSTEM =
  'You are a songwriter. Write original song lyrics for the requested topic and style. ' +
  'Use structure tags on their own lines: [verse], [chorus], [verse], [chorus]. Keep it to about 10-14 short lines total, ' +
  'simple singable phrasing, no stage directions, no emoji, and nothing hateful or explicit. Output ONLY the lyrics.';

const label = (v: VoiceDef) => `${voiceIcon(v)} ${v.label} — ${v.blurb ?? `${v.lang} ${v.gender}${v.engine === 'edge' ? ' · online' : ''}`}`.slice(0, 100);

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

/** Full AI song: the text becomes the lyrics (or, if it's just a short phrase and an AI is configured, a topic to write lyrics about). */
async function aiSong(i: ChatInputCommandInteraction, voice: VoiceDef, text: string) {
  const style = SONG_STYLES[voice.id.replace('song:', '')]!;
  const wait = singCooldown(i.user.id);
  if (wait > 0) throw new MediaError(`The studio needs a breather — you can record another full song in ${Math.ceil(wait / 60_000)} min. (The quick 🎵 sing-song voices have no such wait.)`);
  try {
    if (!(await singHealthy())) throw new MediaError('The AI singer isn\'t running on this bot\'s host right now. Try one of the quick 🎵 sing-song voices instead!');
    let lyrics = text;
    let note = '';
    if (text.trim().split(/\s+/).length <= 12 && llmConfigured()) {
      await i.editReply('✍️ Writing lyrics…');
      lyrics = await ask(LYRIC_SYSTEM, `Topic: ${text}\nStyle: ${style.prompt}`, { temperature: 0.9, maxTokens: 400 });
      note = ' *(lyrics written from your text)*';
    }
    const ahead = queueLength();
    await i.editReply(`🎤 ${ahead > 0 ? `${ahead} song${ahead > 1 ? 's' : ''} ahead of yours…` : 'Recording…'} a ${SING_SECONDS}s song can take a few minutes.`);
    const song = await queuedSong(() => generateSong({ style: style.prompt, lyrics },
      stage => { void i.editReply(`🎤 ${stage === 'composing' ? 'Composing and singing…' : `Studio: ${stage}`}`).catch(() => {}); }));
    await sendAudio(i, song.mp3, 'song.mp3', `🎤 **${style.label}**${note}${song.bpm ? ` · ${Math.round(song.bpm)} BPM` : ''}\n${sanitizeReply(lyrics, 900).split('\n').map(l => `> ${l}`).join('\n').slice(0, 1000)}`);
  } catch (err) {
    refundSingCooldown(i.user.id);
    throw err;
  }
}

const Tts: Command = {
  data: new SlashCommandBuilder()
    .setName('tts')
    .setDescription('Text to speech — and singing voices! (free, no limits)')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addStringOption(o => o.setName('text').setDescription(`What to say or sing (up to ${MAX_TEXT} characters)`).setRequired(true).setMaxLength(2000))
    .addStringOption(o => o.setName('voice').setDescription('Pick a voice — try "sing" to see the singing ones').setAutocomplete(true))
    .addNumberOption(o => o.setName('speed').setDescription('Speaking speed 0.5–2 (speech voices only, default 1)').setMinValue(0.5).setMaxValue(2))
    .addBooleanOption(o => o.setName('voicemessage').setDescription('Send as a Discord voice message')),

  async autocomplete(i: AutocompleteInteraction) {
    await ensureElevenVoices(); // cached for an hour; a no-op without an ElevenLabs key
    await i.respond(searchVoices(i.options.getFocused()).map(v => ({ name: label(v), value: v.id })));
  },

  run: mediaHandler(async (i: ChatInputCommandInteraction) => {
    const raw = i.options.getString('text', true);
    const voiceOpt = i.options.getString('voice');
    await ensureElevenVoices();
    const voice = findVoice(voiceOpt);
    if (!voice) throw new MediaError(`I don't know a voice called "${voiceOpt}". Start typing the voice option to see the list (${ALL_VOICES.length} voices).`);

    if (voice.engine === 'song') { await aiSong(i, voice, raw.slice(0, 1800)); return; }

    const wait = voice.engine === 'sing' ? liteCooldown(i.user.id) : ttsCooldown(i.user.id);
    if (wait > 0) throw new MediaError(`Slow down — you can use /tts again in ${Math.ceil(wait / 1000)}s.`);

    if (voice.engine === 'sing') {
      const r = await singLite(cleanForSpeech(raw).slice(0, MAX_TEXT), voice.id.replace('sing:', ''));
      await sendAudio(i, r.mp3, 'singing.mp3', `🎵 **${r.melody.label}** — ${r.words} word${r.words === 1 ? '' : 's'}, ${r.seconds.toFixed(0)}s${cleanForSpeech(raw).split(/\s+/).length > MAX_WORDS ? ` *(sang the first ${MAX_WORDS} words)*` : ''}`);
      return;
    }

    // ElevenLabs bills per character: set the characters aside first, and give them back if a free voice ended up speaking.
    let reserved = 0;
    if (voice.engine === 'eleven') {
      const chars = speakableLength(raw);
      const premium = (await premiumOf(i)).premium;
      const r = reserveChars(i.user.id, chars, premium);
      if (!r.ok) {
        throw new MediaError(r.reason === 'user'
          ? `You've used your free ✨ ElevenLabs characters for today (${freeCharsPerDay().toLocaleString()} a day, ${r.left.toLocaleString()} left).${premiumConfigured() ? ' Premium removes that limit — see `/premium buy`.' : ''} Any free voice has no limit.`
          : 'The ✨ ElevenLabs voices have hit their daily limit for everyone — try again tomorrow, or use any free voice.');
      }
      reserved = chars;
    }
    let r;
    try { r = await speak(raw, voiceOpt, i.options.getNumber('speed') ?? 1); }
    catch (err) { if (reserved) refundChars(i.user.id, reserved); throw err; }
    if (reserved && r.voice.engine !== 'eleven') refundChars(i.user.id, reserved);
    await sendAudio(i, r.mp3, 'speech.mp3', `${voiceIcon(r.voice)} **${r.voice.label}**${r.voice.engine === 'edge' ? ' *(online voice)*' : ''}${r.voice.engine === 'eleven' ? ' *(ElevenLabs)*' : ''}${r.note ? `\n${r.note}` : ''}`);
  }),
};

export default Tts;
void TTS_COOLDOWN_MS;
