import { describe, expect, test } from 'bun:test';
import { PermissionFlagsBits } from 'discord.js';
import { categoryLabel, categoryView, commandView, helpFor, overview, suggestions, toHelp } from '../src/info/help';
import { INVITE_PERMISSIONS, botSubs, inviteUrl } from '../src/subcommands/info/bot';
import { fakeInteraction, textOf } from './fakeInteraction';

// Loads every real command module — this doubles as a smoke test that they all import and build.
const registry = (await import('../src/handlers/commandHandler')).default;
const list = toHelp(registry.values());

describe('/help over the real command registry', () => {
  test('every slash command appears, each with a description and at least one entry', () => {
    const slash = [...registry.values()].filter(c => !(c.data.toJSON() as { type?: number }).type || (c.data.toJSON() as { type?: number }).type === 1);
    expect(list.length).toBe(slash.length);
    for (const c of list) { expect(c.description.length, c.name).toBeGreaterThan(0); expect(c.entries.length, c.name).toBeGreaterThan(0); for (const e of c.entries) expect(e.description.length, e.path).toBeGreaterThan(0); }
  });
  test('overview fits in one message and names every category', () => {
    const o = overview(list);
    expect(o.length).toBeLessThanOrEqual(3300);
    for (const cat of new Set(list.map(c => c.category))) expect(o, cat).toContain(categoryLabel(cat));
  });
  test('command and category views', () => {
    const t = commandView(list, '/qr')!;
    expect(t).toContain('/qr generate'); expect(t).toContain('/qr scan'); expect(t.length).toBeLessThanOrEqual(3300);
    expect(commandView(list, 'juul')).toContain('/juul hit');
    expect(commandView(list, 'settings')).toContain('/settings'); expect(commandView(list, 'privacy')).toContain('/privacy delete');
    expect(categoryView(list, 'utility')).toContain('/crypto'); expect(categoryView(list, 'nope')).toBeUndefined(); expect(commandView(list, 'nope')).toBeUndefined();
    // the biggest command still fits
    for (const c of list) expect(commandView(list, c.name)!.length, c.name).toBeLessThanOrEqual(3300);
    for (const cat of new Set(list.map(c => c.category))) expect(categoryView(list, cat)!.length, cat).toBeLessThanOrEqual(3300);
  });
  test('autocomplete returns valid choices (≤25, names ≤100 chars) that resolve back to a view', () => {
    for (const q of ['', 't', 'fun', 'eco', 'zzzz', '/set']) {
      const s = suggestions(list, q);
      expect(s.length).toBeLessThanOrEqual(25);
      for (const x of s) { expect(x.name.length).toBeLessThanOrEqual(100); expect(x.value.length).toBeLessThanOrEqual(100); expect(helpFor(list, x.value).found, x.value).toBe(true); }
    }
    expect(suggestions(list, 'settings').some(x => x.value === 'settings')).toBe(true);
  });
  test('unknown queries get a helpful, non-crashing answer', () => {
    expect(helpFor(list, 'crypt').found).toBe(false); expect(helpFor(list, 'crypt').text).toContain('/crypto');
    expect(helpFor(list, 'qqqqqq').text).toContain('Run `/help`'); expect(helpFor(list, null).found).toBe(true); expect(helpFor(list, '   ').text).toBe(overview(list));
    expect(helpFor(list, 'x'.repeat(500)).text.length).toBeLessThan(200);
  });
});

describe('/bot', () => {
  test('invite links: least-privilege permissions, user-install variant', () => {
    const s = new URL(inviteUrl('123'));
    expect(s.searchParams.get('client_id')).toBe('123'); expect(s.searchParams.get('scope')).toBe('bot applications.commands');
    const perms = BigInt(s.searchParams.get('permissions')!);
    expect(perms & PermissionFlagsBits.Administrator).toBe(0n); expect(perms & PermissionFlagsBits.SendMessages).toBeTruthy(); expect(perms).toBe(INVITE_PERMISSIONS.bitfield);
    const u = new URL(inviteUrl('123', 'user'));
    expect(u.searchParams.get('integration_type')).toBe('1'); expect(u.searchParams.get('scope')).toBe('applications.commands'); expect(u.searchParams.has('permissions')).toBe(false);
  });
  test('about and invite render', async () => {
    const client = { user: { id: '999', username: 'Bestow', displayAvatarURL: () => 'https://cdn.discordapp.com/x.png' }, guilds: { cache: { size: 3 } }, ws: { ping: 42.4 } };
    for (const name of ['about', 'invite']) {
      const fi = fakeInteraction(); (fi.interaction as unknown as { client: unknown }).client = client;
      await botSubs.find(s => s.name === name)!.run(fi.interaction);
      const t = textOf(fi.last());
      expect(t, name).toContain(name === 'about' ? 'Servers:** 3' : 'Add me');
    }
  });
});
