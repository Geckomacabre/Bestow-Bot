import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Routes, type ChatInputCommandInteraction } from 'discord.js';
import { ffmpeg, probe, withWorkdir } from './media.js';

/**
 * Discord voice messages are ordinary channel messages with flag IS_VOICE_MESSAGE (1 << 13), exactly one
 * OGG/Opus attachment, and two extra attachment fields: duration_secs and a base64 waveform (≤256 bytes, 0–255).
 * discord.js has no helper for this, so the payload is built by hand and posted through its REST client.
 */

export const IS_VOICE_MESSAGE = 1 << 13;
export const WAVEFORM_POINTS = 256;

export interface VoiceMessage { ogg: Buffer; durationSecs: number; waveform: string }

/** Sample-peak envelope → up to 256 bytes (0–255), base64. Slightly boosted so quiet speech still shows bars. */
export function waveformFromPcm(pcm: Int16Array, points = WAVEFORM_POINTS): string {
  const n = Math.max(1, Math.min(points, pcm.length));
  const out = Buffer.alloc(n);
  const per = pcm.length / n;
  for (let i = 0; i < n; i++) {
    let peak = 0;
    const from = Math.floor(i * per), to = Math.max(from + 1, Math.floor((i + 1) * per));
    for (let j = from; j < to && j < pcm.length; j++) peak = Math.max(peak, Math.abs(pcm[j]!));
    out[i] = Math.round(255 * Math.min(1, (peak / 32768) * 1.6) ** 0.75);
  }
  return out.toString('base64');
}

export async function makeVoiceMessage(audio: Buffer, ext = 'mp3'): Promise<VoiceMessage> {
  return withWorkdir(async dir => {
    const input = `in.${ext}`;
    await writeFile(path.join(dir, input), audio);
    await ffmpeg(['-i', input, '-c:a', 'libopus', '-b:a', '48k', '-ar', '48000', '-ac', '1', '-application', 'voip', '-f', 'ogg', 'voice-message.ogg'], { cwd: dir });
    await ffmpeg(['-i', 'voice-message.ogg', '-f', 's16le', '-ac', '1', '-ar', '8000', 'wave.pcm'], { cwd: dir });
    const raw = await readFile(path.join(dir, 'wave.pcm'));
    const pcm = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2));
    const info = await probe('voice-message.ogg', dir);
    return { ogg: await readFile(path.join(dir, 'voice-message.ogg')), durationSecs: Math.max(0.1, info.duration || pcm.length / 8000), waveform: waveformFromPcm(pcm) };
  });
}

/** The REST body + file for POST /channels/{id}/messages. */
export function buildVoicePayload(vm: VoiceMessage) {
  return {
    body: { flags: IS_VOICE_MESSAGE, attachments: [{ id: '0', filename: 'voice-message.ogg', duration_secs: Number(vm.durationSecs.toFixed(3)), waveform: vm.waveform }] },
    files: [{ name: 'voice-message.ogg', data: vm.ogg, contentType: 'audio/ogg' }],
  };
}

/**
 * Post the voice message into the channel. Returns false (so the caller can fall back to a normal attachment) if it
 * can't — no permission, a DM/user-install context where the bot isn't in the channel, or Discord refusing it.
 */
export async function sendVoiceMessage(interaction: ChatInputCommandInteraction, vm: VoiceMessage): Promise<boolean> {
  if (!interaction.channelId) return false;
  try {
    const { body, files } = buildVoicePayload(vm);
    await interaction.client.rest.post(Routes.channelMessages(interaction.channelId), { body, files });
    return true;
  } catch {
    return false;
  }
}
