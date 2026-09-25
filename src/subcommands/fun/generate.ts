import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChatInputCommandInteraction, User } from 'discord.js';
import type { Sub, SubGroup } from '../../framework/group.js';
import { choiceValue, hsub, type OptTweak } from '../../framework/heist.js';
import { MediaError, download, ffmpeg, findMedia, GIF_PALETTE, mediaHandler, sendBuffer, sendFile, withWorkdir } from '../../framework/media.js';
import { lookup, LookupError } from '../../lookups/handler.js';
import { renderRip } from '../../generate/render.js';
import {
  DISPLAY_FONTS, parseReactions, renderApplication, renderFriendRequest, renderMessages, renderReport, renderVoice, stamp,
  type DisplayFont, type DTheme, type Msg,
} from '../../generate/discord.js';
import { LYRIC_BACKGROUNDS, LYRIC_SIZES, renderAmongUs, renderSpotifyLyrics, renderTikTokFollow } from '../../generate/extras.js';
import { aiWatermark, type Brand, type Corner } from '../../generate/aiwatermark.js';
import { loadAvatar, personFor } from '../../generate/people.js';
import { openTierBuilder } from '../../generate/tierlist.js';
import { encode } from '../../media/anim.js';
import * as fx from '../../media/effects.js';
import { generateQuote } from '../../utils/quote.js';

/** /generate — joke images in Heist's shapes (docs/heist-spec.json). Every fake carries a small "not a real screenshot" line. */

type I = ChatInputCommandInteraction;

/** A one-frame GIF of a PNG (Heist's `togif`: so the picture can be saved as a Discord favourite). */
export async function pngToGif(png: Buffer): Promise<Buffer> {
  return withWorkdir(async dir => {
    await Bun.write(path.join(dir, 'in.png'), png);
    await ffmpeg(['-i', 'in.png', '-vf', GIF_PALETTE, '-frames:v', '1', 'out.gif'], { cwd: dir });
    return readFile(path.join(dir, 'out.gif'));
  });
}
async function send(i: I, png: Buffer, base: string, gif = i.options.getBoolean('togif') ?? false) {
  await sendBuffer(i, gif ? await pngToGif(png) : png, `${base}.${gif ? 'gif' : 'png'}`);
}

/** Heist's display_font choices are registered as integers (choiceValue); map them back to the font names. */
const FONT_BY_VALUE = new Map<number, DisplayFont>(DISPLAY_FONTS.map((name, n) => [choiceValue('integer', name, n) as number, name]));
const displayFont = (i: I, opt: string) => { const v = i.options.getInteger(opt); return v == null ? null : FONT_BY_VALUE.get(v) ?? null; };
const theme = (i: I) => (i.options.getString('theme') ?? 'Dark') as DTheme;

async function attachedImage(i: I, opt = 'image') {
  const a = i.options.getAttachment(opt);
  if (!a) return null;
  if (!a.contentType?.startsWith('image/')) throw new LookupError(`\`${opt}\` must be an image.`);
  const img = await loadAvatar(a.url, 800);
  if (!img) throw new LookupError('I couldn\'t read that image.');
  return img;
}

const text = (max: number): OptTweak => ({ maxLength: max });
const joined = (u: User) => u.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// ─── /generate fake … ────────────────────────────────────────────────────────

export const fakeSubs: Sub[] = [
  hsub('generate fake message', lookup(async i => {
    const u = i.options.getUser('user') ?? i.user;
    const who = await personFor(i, u, { useUsername: i.options.getBoolean('use_username') ?? false, hideTag: i.options.getBoolean('hide_clantags') ?? false, font: displayFont(i, 'display_font'), ownStyle: true }, 'user');
    const msg: Msg = { who, text: i.options.getString('text', true), time: stamp(i.options.getString('timestamp')), image: await attachedImage(i), mention: i.options.getBoolean('mention_highlight') ?? false, reactions: parseReactions(i.options.getString('reactions')) };
    await send(i, renderMessages([msg], { theme: theme(i) }), 'message');
  }), { tweaks: { text: text(2000), timestamp: text(40), reactions: text(200) } }),

  hsub('generate fake convo', lookup(async i => {
    const opts = { useUsername: i.options.getBoolean('use_usernames') ?? false, hideTag: i.options.getBoolean('hide_clantags') ?? false, ownStyle: i.options.getBoolean('custom_display_fonts') ?? false };
    const time = stamp(i.options.getString('timestamp'));
    const people = new Map<string, Awaited<ReturnType<typeof personFor>>>();
    const msgs: Msg[] = [];
    for (let n = 1; n <= 10; n++) {
      const u = i.options.getUser(`user${n}`), t = i.options.getString(`msg${n}`);
      if (!u && !t) continue;
      if (!u || !t) throw new LookupError(`Give both \`user${n}\` and \`msg${n}\`.`);
      if (!people.has(u.id)) people.set(u.id, await personFor(i, u, opts, `user${n}`));
      msgs.push({ who: people.get(u.id)!, text: t, time });
    }
    await sendBuffer(i, renderMessages(msgs, { theme: theme(i) }), 'convo.png');
  }), { tweaks: Object.fromEntries([...Array(10)].map((_, n) => [`msg${n + 1}`, text(1000)]).concat([['timestamp', text(40)]])) }),

  hsub('generate fake reply', lookup(async i => {
    const opts = { useUsername: i.options.getBoolean('use_usernames') ?? false, hideTag: i.options.getBoolean('hide_clantags') ?? false, ownStyle: true };
    const [ru, u] = [i.options.getUser('reply_user', true), i.options.getUser('user') ?? i.user];
    const replied = await personFor(i, ru, { ...opts, font: displayFont(i, 'reply_display_font') }, 'reply_user');
    const who = await personFor(i, u, { ...opts, font: displayFont(i, 'display_font') }, 'user');
    const msg: Msg = {
      who, text: i.options.getString('text', true), time: stamp(i.options.getString('timestamp')), reply: { who: replied, text: i.options.getString('reply_text', true) },
      image: await attachedImage(i), mention: i.options.getBoolean('mention_highlight') ?? false, reactions: parseReactions(i.options.getString('reactions')),
    };
    await send(i, renderMessages([msg], { theme: theme(i) }), 'reply');
  }), { tweaks: { text: text(2000), reply_text: text(500), timestamp: text(40), reactions: text(200) } }),

  hsub('generate fake quote', lookup(async i => {
    const u = i.options.getUser('user', true);
    const m = i.options.getMember('user');
    const name = (m && 'displayName' in m ? m.displayName : null) ?? u.globalName ?? u.username;
    const png = await generateQuote({ text: i.options.getString('text', true), authorName: name, authorHandle: `@${u.username}`, authorAvatarUrl: u.displayAvatarURL({ extension: 'png', size: 1024 }) });
    await sendBuffer(i, png, 'quote.png');
  }), { tweaks: { text: text(500) } }),

  hsub('generate fake apply', lookup(async i => {
    const u = i.options.getUser('user', true);
    const who = await personFor(i, u, { useUsername: i.options.getBoolean('use_username') ?? false, hideTag: true }, 'user');
    const status = i.options.getString('status') as 'Approved' | 'Rejected' | null;
    await sendBuffer(i, renderApplication({ who, handle: u.username, joined: joined(u), question: i.options.getString('question', true), answer: i.options.getString('answer', true), status, reason: i.options.getString('reason') }), 'application.png');
  }), { tweaks: { question: text(300), answer: text(1000), reason: text(300) } }),

  hsub('generate fake request', lookup(async i => {
    const u = i.options.getUser('user', true);
    const who = await personFor(i, u, { useUsername: i.options.getBoolean('use_username') ?? false, hideTag: true }, 'user');
    await send(i, renderFriendRequest({ who, age: (i.options.getString('age') ?? '1m').trim().slice(0, 12) || '1m' }), 'friend-request');
  }), { tweaks: { age: text(12) } }),

  hsub('generate fake report', lookup(async i => {
    const u = i.options.getUser('user', true);
    const who = await personFor(i, u, { useUsername: i.options.getBoolean('use_username') ?? false, hideTag: i.options.getBoolean('hide_clantags') ?? false }, 'user');
    await sendBuffer(i, renderReport({ who, message: i.options.getString('message', true), reason: i.options.getString('reason') ?? 'child self-endangerment', time: stamp(i.options.getString('timestamp')), theme: (i.options.getString('theme') ?? 'Dark') as 'Dark' | 'Onyx' | 'Light' }), 'report.png');
  }), { tweaks: { message: text(600), reason: text(120), timestamp: text(40) } }),

  hsub('generate fake vc', lookup(async i => {
    const people = [];
    for (let n = 1; n <= 5; n++) {
      const u = i.options.getUser(`user${n}`);
      if (u) people.push(await personFor(i, u, { useUsername: i.options.getBoolean('use_usernames') ?? false, hideTag: true }, `user${n}`));
    }
    await sendBuffer(i, renderVoice(i.options.getString('channel') ?? 'General', people, { theme: theme(i) }), 'vc.png');
  }), { tweaks: { channel: text(60) } }),

  hsub('generate fake tiktokfollowing', lookup(async i => {
    const u = i.options.getUser('user'), override = i.options.getString('username')?.trim();
    const base = u ?? (override ? null : i.user);
    const name = base ? base.username : override!;
    const avatar = (await attachedImage(i, 'avatar')) ?? (base ? await loadAvatar(base.displayAvatarURL({ extension: 'png', size: 128, forceStatic: true })) : null);
    await sendBuffer(i, renderTikTokFollow({ name, avatar, ago: (i.options.getString('timeago') ?? '1d').trim().slice(0, 12) || '1d', theme: (i.options.getString('theme') ?? 'Dark') as 'Dark' | 'Black' }), 'tiktok.png');
  }), { tweaks: { username: text(40), timeago: text(12) } }),

  hsub('generate fake ai-watermark', mediaHandler(async i => {
    await withWorkdir(async dir => {
      const job = await fx.makeJob(dir, await download(await findMedia(i, 'any'), dir));
      if (!job.info.hasVideo) throw new MediaError('That needs an image, GIF or video.');
      const out = await aiWatermark(job, {
        brand: i.options.getString('brand', true) as Brand, corner: (i.options.getString('position') ?? 'Bottom Right') as Corner,
        opacity: i.options.getNumber('opacity') ?? 1, animate: i.options.getBoolean('animate'),
      });
      await sendFile(i, dir, out.file, { name: out.name });
    });
  }), { tweaks: { opacity: { min: 0.1, max: 1 } } }),
];

// ─── /generate … ─────────────────────────────────────────────────────────────

export const generateSubs: Sub[] = [
  hsub('generate among-us', lookup(async i => {
    const role = { role: i.options.getString('role', true), description: i.options.getString('description') };
    if (!(i.options.getBoolean('togif') ?? false)) { await sendBuffer(i, renderAmongUs(role)[0]!, 'among-us.png'); return; }
    await withWorkdir(async dir => {
      const out = await encode(dir, renderAmongUs(role, 24), 12, 'gif', 'among-us');
      await sendFile(i, dir, out.file, { name: out.name });
    });
  }), { tweaks: { role: text(40), description: text(120) } }),

  hsub('generate rip', lookup(async i => {
    const u = i.options.getUser('user', true);
    const who = await personFor(i, u, { hideTag: true }, 'user');
    const reason = i.options.getString('reason')?.trim();
    const png = renderRip({ name: who.name, avatar: who.avatar, dates: `${u.createdAt.getFullYear()} – ${new Date().getFullYear()}`, epitaph: reason ? `Cause of death: ${reason}` : undefined });
    await send(i, png, 'rip');
  }), { tweaks: { reason: text(100) } }),

  hsub('generate spotifylyrics', lookup(async i => {
    const lines = ['text', 'text2', 'text3', 'text4', 'text5'].map(n => i.options.getString(n)).filter((t): t is string => !!t?.trim());
    await sendBuffer(i, renderSpotifyLyrics(lines, {
      size: (i.options.getString('size') ?? 'Large') as keyof typeof LYRIC_SIZES, background: (i.options.getString('background') ?? 'Teal') as keyof typeof LYRIC_BACKGROUNDS,
    }), 'lyrics.png');
  }), { tweaks: Object.fromEntries(['text', 'text2', 'text3', 'text4', 'text5'].map(n => [n, text(200)])) }),

  hsub('generate tierlist', openTierBuilder),
];

export const generateGroups: SubGroup[] = [
  { name: 'fake', description: 'Fake Discord messages, replies, conversations and more', subs: fakeSubs },
];
