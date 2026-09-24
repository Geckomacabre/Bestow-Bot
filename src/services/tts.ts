import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { withLock } from '../framework/mutex.js';
import { ffmpeg, withWorkdir, MediaError } from '../framework/media.js';

/**
 * Free text-to-speech. Two engines:
 *  - Kokoro (default): an 82M-parameter model that runs locally on CPU — no key, no quota, no internet after the
 *    first download (~90 MB, cached under data/models).
 *  - Edge: Microsoft's online neural voices via msedge-tts — many languages, needs internet, unofficial API.
 */

export type Engine = 'kokoro' | 'edge' | 'sing' | 'song' | 'char';
export interface VoiceDef { id: string; label: string; engine: Engine; lang: string; gender: 'Female' | 'Male'; blurb?: string }

const K = (id: string, label: string, lang: string, gender: 'Female' | 'Male'): VoiceDef => ({ id, label, engine: 'kokoro', lang, gender });
export const KOKORO_VOICES: VoiceDef[] = [
  K('af_heart', 'Heart', 'en-US', 'Female'), K('af_alloy', 'Alloy', 'en-US', 'Female'), K('af_aoede', 'Aoede', 'en-US', 'Female'),
  K('af_bella', 'Bella', 'en-US', 'Female'), K('af_jessica', 'Jessica', 'en-US', 'Female'), K('af_kore', 'Kore', 'en-US', 'Female'),
  K('af_nicole', 'Nicole', 'en-US', 'Female'), K('af_nova', 'Nova', 'en-US', 'Female'), K('af_river', 'River', 'en-US', 'Female'),
  K('af_sarah', 'Sarah', 'en-US', 'Female'), K('af_sky', 'Sky', 'en-US', 'Female'),
  K('am_adam', 'Adam', 'en-US', 'Male'), K('am_echo', 'Echo', 'en-US', 'Male'), K('am_eric', 'Eric', 'en-US', 'Male'),
  K('am_fenrir', 'Fenrir', 'en-US', 'Male'), K('am_liam', 'Liam', 'en-US', 'Male'), K('am_michael', 'Michael', 'en-US', 'Male'),
  K('am_onyx', 'Onyx', 'en-US', 'Male'), K('am_puck', 'Puck', 'en-US', 'Male'), K('am_santa', 'Santa', 'en-US', 'Male'),
  K('bf_alice', 'Alice', 'en-GB', 'Female'), K('bf_emma', 'Emma', 'en-GB', 'Female'), K('bf_isabella', 'Isabella', 'en-GB', 'Female'), K('bf_lily', 'Lily', 'en-GB', 'Female'),
  K('bm_daniel', 'Daniel', 'en-GB', 'Male'), K('bm_fable', 'Fable', 'en-GB', 'Male'), K('bm_george', 'George', 'en-GB', 'Male'), K('bm_lewis', 'Lewis', 'en-GB', 'Male'),
];

const E = (id: string, label: string, lang: string, gender: 'Female' | 'Male'): VoiceDef => ({ id: `edge:${id}`, label, engine: 'edge', lang, gender });
export const EDGE_VOICES: VoiceDef[] = [
  E('en-US-AriaNeural', 'Aria', 'en-US', 'Female'), E('en-US-JennyNeural', 'Jenny', 'en-US', 'Female'), E('en-US-GuyNeural', 'Guy', 'en-US', 'Male'),
  E('en-US-DavisNeural', 'Davis', 'en-US', 'Male'), E('en-GB-SoniaNeural', 'Sonia', 'en-GB', 'Female'), E('en-GB-RyanNeural', 'Ryan', 'en-GB', 'Male'),
  E('en-AU-NatashaNeural', 'Natasha', 'en-AU', 'Female'), E('en-AU-WilliamNeural', 'William', 'en-AU', 'Male'), E('en-IN-NeerjaNeural', 'Neerja', 'en-IN', 'Female'),
  E('es-ES-ElviraNeural', 'Elvira', 'es-ES', 'Female'), E('es-MX-JorgeNeural', 'Jorge', 'es-MX', 'Male'), E('fr-FR-DeniseNeural', 'Denise', 'fr-FR', 'Female'),
  E('de-DE-KatjaNeural', 'Katja', 'de-DE', 'Female'), E('it-IT-ElsaNeural', 'Elsa', 'it-IT', 'Female'), E('pt-BR-FranciscaNeural', 'Francisca', 'pt-BR', 'Female'),
  E('ja-JP-NanamiNeural', 'Nanami', 'ja-JP', 'Female'), E('ko-KR-SunHiNeural', 'Sun-Hi', 'ko-KR', 'Female'), E('zh-CN-XiaoxiaoNeural', 'Xiaoxiao', 'zh-CN', 'Female'),
  E('ru-RU-SvetlanaNeural', 'Svetlana', 'ru-RU', 'Female'), E('hi-IN-SwaraNeural', 'Swara', 'hi-IN', 'Female'), E('ar-SA-ZariyahNeural', 'Zariyah', 'ar-SA', 'Female'),
];

// Singing voices. "sing:" ones are instant local sing-song (see singlite.ts); "song:" ones make a full AI song (see sing.ts).
const SG = (id: string, label: string, gender: 'Female' | 'Male', blurb: string): VoiceDef => ({ id: `sing:${id}`, label, engine: 'sing', lang: 'en-US', gender, blurb });
export const SING_VOICES: VoiceDef[] = [
  SG('pop', 'Happy pop', 'Female', 'quick · bouncy major-key melody'), SG('ballad', 'Sad ballad', 'Female', 'quick · slow and minor'),
  SG('opera', 'Opera diva', 'Female', 'quick · high and wobbly'), SG('lullaby', 'Lullaby', 'Female', 'quick · soft and sleepy'),
  SG('rock', 'Rock belt', 'Male', 'quick · loud and crunchy'), SG('chipmunk', 'Chipmunk choir', 'Female', 'quick · tiny and excited'),
  SG('crooner', 'Deep crooner', 'Male', 'quick · low and smooth'), SG('tenor', 'Tenor', 'Male', 'quick · warm, rising phrases'),
  SG('sunshine', 'Sunshine soon', 'Male', 'quick · sunny and skipping'), SG('breeze', 'Warmy breeze', 'Female', 'quick · gentle and floaty'),
  SG('glorious', 'Glorious', 'Female', 'quick · big, heroic, echoing'), SG('goesup', 'It goes up', 'Male', 'quick · every word climbs higher'),
  SG('dramatic', 'Dramatic', 'Female', 'quick · slow, huge pitch jumps'),
];

/**
 * Character-style voices: a Kokoro voice run through an audio-effect chain (radio helmet, creepy mask…).
 * These are original effect styles, not copies of any actor's voice.
 */
export const CHAR_STYLES: Record<string, { label: string; base: string; gender: 'Female' | 'Male'; blurb: string; fx: string }> = {
  trooper: { label: 'Helmet trooper', base: 'am_adam', gender: 'Male', blurb: 'crackly radio helmet', fx: 'highpass=f=320,lowpass=f=3100,acrusher=bits=9:mode=lin:mix=0.35,aecho=0.6:0.5:9:0.3,volume=1.5' },
  masked: { label: 'Masked caller', base: 'am_onyx', gender: 'Male', blurb: 'low, raspy and creepy', fx: 'asetrate=20100,aresample=24000,atempo=0.9,lowpass=f=4200,tremolo=f=6:d=0.25,aecho=0.7:0.6:38:0.32' },
  rascal: { label: 'Raspy rascal', base: 'am_puck', gender: 'Male', blurb: 'scrappy, fast and gravelly', fx: 'asetrate=27600,aresample=24000,atempo=0.95,acrusher=bits=10:mode=log:mix=0.35,highpass=f=150' },
  robot: { label: 'Robot', base: 'af_alloy', gender: 'Female', blurb: 'metallic and monotone', fx: 'tremolo=f=95:d=0.85,aecho=0.8:0.9:7:0.5,highpass=f=200' },
};
export const CHAR_VOICES: VoiceDef[] = Object.entries(CHAR_STYLES).map(([id, v]) => ({
  id: `char:${id}`, label: v.label, engine: 'char' as const, lang: 'en-US', gender: v.gender, blurb: v.blurb,
}));

/** Style prompts for the full-song AI singers. The user's text becomes the lyrics. */
export const SONG_STYLES: Record<string, { label: string; gender: 'Female' | 'Male'; prompt: string }> = {
  'pop-female': { label: 'Pop singer', gender: 'Female', prompt: 'upbeat modern pop, catchy melody, female lead vocals, bright production' },
  'rock-male': { label: 'Rock singer', gender: 'Male', prompt: 'energetic rock, driving drums, electric guitars, male lead vocals' },
  ballad: { label: 'Ballad singer', gender: 'Female', prompt: 'emotional piano ballad, slow tempo, expressive female vocals' },
  rap: { label: 'Rapper', gender: 'Male', prompt: 'hip hop, rap vocals, boom bap drums, confident male rapper' },
  lofi: { label: 'Lo-fi chill', gender: 'Female', prompt: 'lo-fi chill, mellow beat, soft breathy female vocals, vinyl warmth' },
  opera: { label: 'Opera singer', gender: 'Female', prompt: 'operatic soprano, dramatic orchestral backing, powerful classical vocals' },
  country: { label: 'Country singer', gender: 'Male', prompt: 'country folk, acoustic guitar, warm male vocals, storytelling' },
};
export const SONG_VOICES: VoiceDef[] = Object.entries(SONG_STYLES).map(([id, v]) => ({
  id: `song:${id}`, label: v.label, engine: 'song' as const, lang: 'en-US', gender: v.gender, blurb: 'full AI song · takes a few minutes',
}));

export const ALL_VOICES: VoiceDef[] = [...KOKORO_VOICES, ...CHAR_VOICES, ...SING_VOICES, ...SONG_VOICES, ...EDGE_VOICES];

export const voiceIcon = (v: Pick<VoiceDef, 'engine'>) => (v.engine === 'sing' ? '🎵' : v.engine === 'song' ? '🎤' : v.engine === 'char' ? '🎭' : v.engine === 'edge' ? '🌐' : '🗣️');
export const DEFAULT_VOICE = 'af_heart';
export const MAX_TEXT = 500;

export function findVoice(id: string | null | undefined): VoiceDef | null {
  if (!id) return ALL_VOICES.find(v => v.id === DEFAULT_VOICE) ?? null;
  const q = id.toLowerCase();
  return ALL_VOICES.find(v => v.id.toLowerCase() === q) ?? ALL_VOICES.find(v => v.label.toLowerCase() === q) ?? null;
}

const FEATURED = ['af_heart', 'am_onyx', 'bf_emma'];
export function searchVoices(query: string, limit = 25): VoiceDef[] {
  const q = query.toLowerCase().trim();
  if (!q) {
    // No search yet: a taste of everything (singing voices are easy to miss otherwise).
    const featured = FEATURED.map(id => ALL_VOICES.find(v => v.id === id)!);
    return [...featured, ...CHAR_VOICES, ...SING_VOICES, ...SONG_VOICES, ...EDGE_VOICES].slice(0, limit);
  }
  return ALL_VOICES
    .filter(v => v.id.toLowerCase().includes(q) || v.label.toLowerCase().includes(q) || v.lang.toLowerCase().includes(q) || v.gender.toLowerCase().startsWith(q)
      || (q.startsWith('sing') && (v.engine === 'sing' || v.engine === 'song')) || (v.engine === 'song' && 'ai singer song'.includes(q)) || (v.engine === 'char' && ('character char'.includes(q) || (v.blurb ?? '').includes(q))))
    .slice(0, limit);
}

/** Make chat text speakable: drop markdown, links, mentions and custom emoji; collapse whitespace. */
export function cleanForSpeech(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<a?:(\w+):\d+>/g, '$1')
    .replace(/<@[!&]?\d+>/g, 'someone')
    .replace(/<#\d+>/g, 'a channel')
    .replace(/<t:\d+(?::\w)?>/g, '')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/[*_~|>]{1,3}/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Engines ─────────────────────────────────────────────────────────────────

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const CACHE_DIR = path.resolve(import.meta.dir, '../../data/models');

type Kokoro = { generate(text: string, o: { voice: string; speed?: number }): Promise<{ toWav(): ArrayBuffer }> };
let kokoroPromise: Promise<Kokoro> | null = null;

function loadKokoro(): Promise<Kokoro> {
  kokoroPromise ??= (async () => {
    const { env } = await import('@huggingface/transformers');
    env.cacheDir = CACHE_DIR;
    const { KokoroTTS } = await import('kokoro-js');
    return (await KokoroTTS.from_pretrained(MODEL_ID, { dtype: 'q8', device: 'cpu' })) as unknown as Kokoro;
  })().catch(err => { kokoroPromise = null; throw err; });
  return kokoroPromise;
}

/** Raw mono PCM (24 kHz floats) for a short text — used by the sing-song engine, which builds its own audio. */
export async function kokoroRaw(text: string, voice: string, speed = 1): Promise<Float32Array> {
  const model = (await loadKokoro()) as unknown as { generate(t: string, o: { voice: string; speed?: number }): Promise<{ audio: Float32Array }> };
  const out = await withLock('tts:kokoro', () => model.generate(text, { voice, speed }));
  return out.audio;
}

/** Kick off the model download/load at startup so the first /tts isn't slow. */
export function warmUpKokoro(): void { void loadKokoro().catch(() => {}); }

async function edgeSynth(text: string, voice: string, speed: number): Promise<Buffer> {
  const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const rate = `${speed >= 1 ? '+' : ''}${Math.round((speed - 1) * 100)}%`;
  const { audioStream } = tts.toStream(text, { rate });
  const chunks: Buffer[] = [];
  for await (const c of audioStream) chunks.push(Buffer.from(c as Buffer));
  const out = Buffer.concat(chunks);
  if (out.length < 200) throw new MediaError('The Edge voice service returned no audio.');
  return out;
}

async function kokoroSynth(text: string, voice: string, speed: number, fx?: string): Promise<Buffer> {
  const model = await loadKokoro();
  // Kokoro is CPU-bound: one synthesis at a time keeps the bot responsive.
  const wav = await withLock('tts:kokoro', async () => Buffer.from((await model.generate(text, { voice, speed })).toWav()));
  return withWorkdir(async dir => {
    await writeFile(path.join(dir, 'in.wav'), wav);
    await ffmpeg(['-i', 'in.wav', '-af', `${fx ? `${fx},` : ''}loudnorm=I=-18:TP=-2:LRA=11`, '-c:a', 'libmp3lame', '-q:a', '4', 'out.mp3'], { cwd: dir });
    return readFile(path.join(dir, 'out.mp3'));
  });
}

export interface SpeechResult { mp3: Buffer; voice: VoiceDef }

/** Text → MP3. Falls back from a local voice to an Edge one (and vice versa) if the chosen engine is unavailable. */
export async function speak(rawText: string, voiceId?: string | null, speed = 1): Promise<SpeechResult> {
  const text = cleanForSpeech(rawText).slice(0, MAX_TEXT);
  if (!text) throw new MediaError('There\'s nothing speakable in that text.');
  const voice = findVoice(voiceId);
  if (!voice) throw new MediaError('I don\'t know that voice — pick one from the list.');
  if (voice.engine === 'sing' || voice.engine === 'song') throw new MediaError('That is a singing voice — it needs the singing path, not plain speech.');
  const sp = Math.min(2, Math.max(0.5, speed));

  const attempt = async (v: VoiceDef) => {
    if (v.engine === 'char') { const c = CHAR_STYLES[v.id.replace('char:', '')]!; return kokoroSynth(text, c.base, sp, c.fx); }
    return v.engine === 'kokoro' ? kokoroSynth(text, v.id, sp) : edgeSynth(text, v.id.replace(/^edge:/, ''), sp);
  };
  try {
    return { mp3: await attempt(voice), voice };
  } catch (err) {
    if (err instanceof MediaError) throw err;
    // The chosen engine failed (no model, offline…): try the other one with an equivalent voice.
    const alt = voice.engine === 'kokoro' || voice.engine === 'char' ? EDGE_VOICES.find(v => v.lang === 'en-US' && v.gender === voice.gender)! : findVoice(DEFAULT_VOICE)!;
    try {
      return { mp3: await attempt(alt), voice: alt };
    } catch {
      console.error('[tts]', err);
      throw new MediaError('Text-to-speech isn\'t available right now — the voice model couldn\'t load and the online fallback is unreachable.');
    }
  }
}

// ─── Per-user cooldown ───────────────────────────────────────────────────────

const last = new Map<string, number>();
export const TTS_COOLDOWN_MS = 8_000;
/** Returns 0 if allowed (and records the use), otherwise ms remaining. */
export function ttsCooldown(userId: string, now = Date.now()): number {
  const wait = (last.get(userId) ?? 0) + TTS_COOLDOWN_MS - now;
  if (wait > 0) return wait;
  last.set(userId, now);
  if (last.size > 5000) for (const [k, t] of last) if (now - t > 60_000) last.delete(k);
  return 0;
}
