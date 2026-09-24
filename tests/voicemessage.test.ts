import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IS_VOICE_MESSAGE, WAVEFORM_POINTS, buildVoicePayload, makeVoiceMessage, sendVoiceMessage, waveformFromPcm } from '../src/framework/voicemessage';
import { ffmpeg } from '../src/framework/media';
import { fakeInteraction } from './fakeInteraction';

const haveFfmpeg = !!Bun.which('ffmpeg');
const it = haveFfmpeg ? test : test.skip;

describe('waveformFromPcm', () => {
  test('never exceeds 256 bytes and is valid base64', () => {
    const w = waveformFromPcm(new Int16Array(80_000).fill(1000));
    const bytes = Buffer.from(w, 'base64');
    expect(bytes.length).toBe(WAVEFORM_POINTS);
    expect(Buffer.from(w, 'base64').toString('base64')).toBe(w);
  });
  test('short clips give fewer points; empty input still yields something', () => {
    expect(Buffer.from(waveformFromPcm(new Int16Array(10)), 'base64').length).toBe(10);
    expect(Buffer.from(waveformFromPcm(new Int16Array(0)), 'base64').length).toBe(1);
  });
  test('loud parts read higher than quiet parts, silence reads zero', () => {
    const pcm = new Int16Array(3000);
    for (let i = 0; i < 1000; i++) pcm[i] = 30000 * Math.sin(i / 3);
    for (let i = 1000; i < 2000; i++) pcm[i] = 2000 * Math.sin(i / 3);
    const b = Buffer.from(waveformFromPcm(pcm, 30), 'base64');
    const avg = (a: number, z: number) => b.subarray(a, z).reduce((s, x) => s + x, 0) / (z - a);
    expect(avg(0, 10)).toBeGreaterThan(avg(10, 20));
    expect(avg(10, 20)).toBeGreaterThan(avg(20, 30));
    expect(avg(20, 30)).toBe(0);
  });
});

describe('payload', () => {
  test('matches the documented voice-message shape', () => {
    const { body, files } = buildVoicePayload({ ogg: Buffer.from('OggS'), durationSecs: 3.14159, waveform: 'AAEC' });
    expect(body.flags).toBe(IS_VOICE_MESSAGE);
    expect(body.flags).toBe(8192);
    expect(body.attachments).toEqual([{ id: '0', filename: 'voice-message.ogg', duration_secs: 3.142, waveform: 'AAEC' }]);
    expect(files).toHaveLength(1);
    expect(files[0]!.name).toBe('voice-message.ogg');
    expect(files[0]!.contentType).toBe('audio/ogg');
    expect(Object.keys(body)).toEqual(['flags', 'attachments']); // voice messages can't carry content/embeds
  });
});

describe('sending', () => {
  const vm = { ogg: Buffer.from('OggS'), durationSecs: 1, waveform: 'AAEC' };
  test('posts to the channel messages route and reports success', async () => {
    const f = fakeInteraction();
    expect(await sendVoiceMessage(f.interaction, vm)).toBe(true);
    expect(f.restPosts).toHaveLength(1);
    expect(f.restPosts[0]!.route).toBe('/channels/c-test/messages');
    expect(f.restPosts[0]!.options.body.flags).toBe(8192);
  });
  test('reports failure (so callers can fall back) when Discord refuses', async () => {
    expect(await sendVoiceMessage(fakeInteraction({ restFails: true }).interaction, vm)).toBe(false);
  });
});

describe('encoding (real ffmpeg)', () => {
  it('produces Ogg/Opus with the right duration and a real waveform', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'onyx-vm-'));
    // 1.0 s tone, 1.0 s silence, 1.0 s tone → the waveform's middle third must be quiet.
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-filter_complex', '[1]atrim=duration=1[s];[0][s][2]concat=n=3:v=0:a=1', '-c:a', 'libmp3lame', 'src.mp3'], { cwd: dir });
    const mp3 = Buffer.from(await Bun.file(path.join(dir, 'src.mp3')).arrayBuffer());
    const vm = await makeVoiceMessage(mp3);
    expect(vm.ogg.subarray(0, 4).toString('ascii')).toBe('OggS');
    expect(vm.ogg.includes(Buffer.from('OpusHead'))).toBe(true);
    expect(vm.durationSecs).toBeGreaterThan(2.7);
    expect(vm.durationSecs).toBeLessThan(3.4);
    const w = Buffer.from(vm.waveform, 'base64');
    expect(w.length).toBe(256);
    const avg = (a: number, z: number) => w.subarray(a, z).reduce((s, x) => s + x, 0) / (z - a);
    expect(avg(10, 70)).toBeGreaterThan(50); // lavfi sine is quiet (amplitude 0.125)
    expect(avg(100, 150)).toBeLessThan(20);
    expect(avg(190, 246)).toBeGreaterThan(50);
  }, 60_000);
});
