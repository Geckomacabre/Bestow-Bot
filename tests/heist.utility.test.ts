import { beforeAll, describe, expect, test } from 'bun:test';
import { initDb } from '../src/utils/db';
import * as tags from '../src/tags/store';
import * as profile from '../src/profile/store';
import { decodeBase64 } from '../src/commands/utility/base64';
import { htmlRedirect, isLocker } from '../src/lookups/bypass';
import { resolveLanguage, searchLanguages } from '../src/lookups/languages';
import { parseDev, parseMw } from '../src/lookups/dictionary';
import { parseEmoji, parseInvite } from '../src/commands/utility/discord';
import { describeTime, resolveZone } from '../src/commands/utility/timezone';
import { freaky, reverse, uwu } from '../src/fun/textstyles';
import { aliasOptions, applySpecArgs, choiceValue, hsub, specDescription } from '../src/framework/heist';
import { SlashCommandSubcommandBuilder } from 'discord.js';
import { fakeInteraction } from './fakeInteraction';

beforeAll(async () => { await initDb(); });

describe('/tags store', () => {
  test('create, list, use, edit, delete — names are normalised', async () => {
    const u = 'tags-u1';
    await tags.createTag(u, 'My Tag', 'hello');
    await expect(tags.createTag(u, 'my-tag', 'again')).rejects.toThrow(/already have/);
    await expect(tags.createTag(u, 'bad name!', 'x')).rejects.toThrow(/letters/);
    await expect(tags.createTag(u, 'empty', '   ')).rejects.toThrow(/text/);
    expect((await tags.useTag(u, 'MY TAG'))!.uses).toBe(1);
    expect(await tags.editTag(u, 'my-tag', 'changed')).toBe(true);
    expect((await tags.getTag(u, 'my-tag'))!.content).toBe('changed');
    expect(await tags.deleteTag(u, 'my-tag')).toBe(true); expect(await tags.deleteTag(u, 'my-tag')).toBe(false);
  });
  test('export codes are one-use, expire, and never overwrite existing tags', async () => {
    const a = 'tags-a', b = 'tags-b', T = 1_000_000;
    await tags.createTag(a, 'one', '1'); await tags.createTag(a, 'two', '2'); await tags.createTag(b, 'two', 'mine');
    const { code, count } = await tags.exportTags(a, T);
    expect(count).toBe(2); expect(code).toMatch(/^TAGS-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(await tags.importTags(b, code.toLowerCase(), T + 1)).toEqual({ added: 1, skipped: ['two'] });
    expect((await tags.getTag(b, 'two'))!.content).toBe('mine');
    await expect(tags.importTags(b, code, T + 2)).rejects.toThrow(/used/);
    const late = await tags.exportTags(a, T);
    await expect(tags.importTags(b, late.code, T + tags.EXPORT_TTL_MS + 1)).rejects.toThrow(/expired/);
    await expect(tags.exportTags('tags-nobody')).rejects.toThrow(/any tags/);
  });
});

describe('/me, /donate, /pingonjoin stores', () => {
  test('UIDs are handed out in order of first use; commands are counted', async () => {
    await profile.countCommand('me-a', 1); await profile.countCommand('me-b', 2); await profile.countCommand('me-a', 3);
    const a = (await profile.userById('me-a'))!, b = (await profile.userById('me-b'))!;
    expect(a.uid).toBeLessThan(b.uid); expect(a.commands).toBe(2); expect(a.first_seen).toBe(1);
    expect((await profile.userByUid(b.uid))!.user_id).toBe('me-b');
  });
  test('donations count only once approved, and can be reviewed only once', async () => {
    const d = await profile.submitDonation('don-a', 'Alice', 12.345, 'thanks!');
    expect(d.amount).toBe(12.35); expect(await profile.donationTotal('don-a')).toBe(0);
    const [first, second] = await Promise.all([profile.reviewDonation(d.id, true), profile.reviewDonation(d.id, false)]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(await profile.donationTotal('don-a')).toBe(first ? 12.35 : 0);
    await expect(profile.submitDonation('don-a', 'A', 0, null)).rejects.toThrow();
  });
  test('ping on join: up to five channels, templates', async () => {
    const g = 'poj-g';
    for (let n = 0; n < 5; n++) expect(await profile.addPingChannel(g, `c${n}`, null, 'admin')).toBe('added');
    expect(await profile.addPingChannel(g, 'c9', null, 'admin')).toBe('full');
    expect(await profile.addPingChannel(g, 'c0', 'hi {user}', 'admin')).toBe('updated');
    expect(await profile.removePingChannel(g, 'c1')).toBe(true); expect(await profile.clearPingChannels(g)).toBe(4);
    expect(profile.renderPing('Welcome {user} to {server}!', '42', 'Cafe')).toBe('Welcome <@42> to Cafe!'); expect(profile.renderPing(null, '42', 'x')).toBe('<@42>');
  });
});

describe('small utilities', () => {
  test('base64 decoding is strict', () => {
    expect(decodeBase64('aGVsbG8=')).toBe('hello'); expect(decodeBase64('aGVsbG8')).toBe('hello'); expect(decodeBase64('aGV sbG8=')).toBe('hello');
    expect(decodeBase64('not base64!')).toBeNull(); expect(decodeBase64('/w==')).toBeNull(); expect(decodeBase64('')).toBeNull();
  });
  test('/bypass reads meta-refresh and script redirects, and spots link lockers', () => {
    expect(htmlRedirect('<meta http-equiv="refresh" content="0; url=https://example.com/a?b=1&amp;c=2">')).toBe('https://example.com/a?b=1&c=2');
    expect(htmlRedirect('<meta content="0;URL=https://x.org" http-equiv="refresh">')).toBe('https://x.org');
    expect(htmlRedirect('<script>window.location.href = "https://y.org/p";</script>')).toBe('https://y.org/p');
    expect(htmlRedirect('<p>no redirect</p>')).toBeNull();
    expect(isLocker('linkvertise.com')).toBe(true); expect(isLocker('link.linkvertise.com')).toBe(true); expect(isLocker('bit.ly')).toBe(false);
  });
  test('languages by name or code', () => {
    expect(resolveLanguage('English')).toBe('en'); expect(resolveLanguage('fr')).toBe('fr'); expect(resolveLanguage('RO')).toBe('ro'); expect(resolveLanguage('chinese')).toBe('zh-CN');
    expect(resolveLanguage('auto')).toBe('auto'); expect(resolveLanguage('Klingon')).toBeNull(); expect(searchLanguages('span')[0]!.value).toBe('es');
  });
  test('timezones by name, city or abbreviation', () => {
    expect(resolveZone('America/New_York')).toBe('America/New_York'); expect(resolveZone('Tokyo')).toBe('Asia/Tokyo'); expect(resolveZone('zzzz-nowhere')).toBeNull();
    const t = describeTime('UTC', new Date('2026-01-02T15:04:00Z'));
    expect(t.time).toBe('3:04 PM'); expect(t.offset).toBe('UTC');
  });
  test('dictionary responses from both sources', () => {
    expect(parseDev([{ word: 'cat', phonetic: '/kat/', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A small feline.', example: 'The cat sat.', synonyms: ['kitty'] }] }] }]))
      .toEqual({ word: 'cat', phonetic: '/kat/', source: 'Free Dictionary', senses: [{ pos: 'noun', defs: ['A small feline.'], example: 'The cat sat.' }], synonyms: ['kitty'] });
    expect(parseMw([{ meta: { id: 'cat:1' }, hwi: { hw: 'cat', prs: [{ mw: 'ˈkat' }] }, fl: 'noun', shortdef: ['a carnivorous mammal'] }], 'cat')).toMatchObject({ word: 'cat', phonetic: '\\ˈkat\\', senses: [{ pos: 'noun', defs: ['a carnivorous mammal'] }] });
    expect(parseMw(['cot', 'cut'], 'cxt')).toBeNull();
  });
  test('emoji and invite parsing', () => {
    expect(parseEmoji('<a:party:123456789012345678>')).toEqual({ animated: true, name: 'party', id: '123456789012345678' });
    expect(parseEmoji('123456789012345678')).toEqual({ animated: false, id: '123456789012345678' });
    expect(parseEmoji('https://cdn.discordapp.com/emojis/123456789012345678.gif?size=48')).toEqual({ animated: true, id: '123456789012345678' });
    expect(parseEmoji('😀')).toBeNull();
    expect(parseInvite('https://discord.gg/abc-DEF')).toBe('abc-DEF'); expect(parseInvite('discord.com/invite/xyz')).toBe('xyz'); expect(parseInvite('abc')).toBe('abc'); expect(parseInvite('no spaces here')).toBeNull();
  });
  test('/say styles', () => {
    expect(freaky('Hey!')).toBe('𝓗𝓮𝔂!'); expect(reverse('ab😀')).toBe('😀ba');
    const u = uwu('Really lovely <@123> https://x.com/rl'); expect(u).toContain('<@123>'); expect(u).toContain('https://x.com/rl'); expect(u).toMatch(/w/);
    expect(uwu('Hello there.')).toBe(uwu('Hello there.')); // deterministic
  });
});

describe('Heist spec builder', () => {
  test('choice values: strings keep the name; numbers come from the leading number, else position', () => {
    expect(choiceValue('string', 'Top Left', 0)).toBe('Top Left'); expect(choiceValue('integer', '144p', 0)).toBe(144); expect(choiceValue('integer', '90°', 2)).toBe(90);
    expect(choiceValue('integer', 'Muted', 1)).toBe(1); expect(choiceValue('number', '0.5x (slow)', 3)).toBe(0.5);
  });
  test('descriptions are rebranded; ✨ is left to the premium flag', () => {
    expect(specDescription({ description: 'View your Heist info', premium: false })).toBe('View your Bestow info');
    expect(specDescription({ description: '✨ Repost an Instagram post/reel', premium: true })).toBe('Repost an Instagram post/reel');
  });
  test('a sub built from the spec has Heist\'s exact options', () => {
    const s = hsub('download', async () => {});
    const b = new SlashCommandSubcommandBuilder().setName('download').setDescription('d');
    s.options!(b);
    const j = b.toJSON() as { options: { name: string; type: number; required?: boolean; choices?: { name: string; value: unknown }[] }[] };
    expect(j.options.map(o => o.name)).toEqual(['url', 'quality', 'audio', 'format']);
    expect(j.options[1]!.choices!.map(c => c.value)).toEqual([144, 240, 360, 480, 720, 1080]);
    expect(j.options[0]!.required).toBe(true);
    const skip = new SlashCommandSubcommandBuilder().setName('a').setDescription('a');
    applySpecArgs(skip, [{ name: 'do', description: 'x', type: 'string', required: true, choices: ['A', 'B'] }], { do: { skipChoices: ['B'] } });
    expect((skip.toJSON() as { options: { choices: unknown[] }[] }).options[0]!.choices).toHaveLength(1);
  });
  test('aliasOptions lets an old handler read renamed options', () => {
    const fi = fakeInteraction({ options: { search: 'cat' } });
    const i = aliasOptions(fi.interaction, { term: 'search' });
    expect(i.options.getString('term')).toBe('cat'); expect(i.options.getString('search')).toBe('cat'); expect(i.user.id).toBe(fi.interaction.user.id);
  });
});
