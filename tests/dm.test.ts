import { beforeAll, describe, expect, test } from 'bun:test';
import { initDb } from '../src/utils/db';
import { fakeInteraction, textOf } from './fakeInteraction';

/**
 * Bestow is a USER-INSTALL bot: people run commands in DMs, group DMs and servers where the bot isn't installed — i.e. with NO guild.
 * This sweeps every leaf of the economy commands through the REAL registry with guildId = null, generating valid arguments from each
 * command's own option schema. A crash here is a bug a user would hit.
 */
const commands = (await import('../src/handlers/commandHandler')).default;
beforeAll(async () => { await initDb(); });

interface Opt { type: number; name: string; required?: boolean; choices?: { value: string | number }[]; min_value?: number; options?: Opt[] }
interface Leaf { command: string; group: string | null; sub: string | null; opts: Opt[] }

function leaves(name: string): Leaf[] {
  const j = commands.get(name)!.data.toJSON() as unknown as { options?: Opt[] };
  const out: Leaf[] = [];
  const top = j.options ?? [];
  if (!top.some(o => o.type === 1 || o.type === 2)) return [{ command: name, group: null, sub: null, opts: top }];
  for (const o of top) {
    if (o.type === 1) out.push({ command: name, group: null, sub: o.name, opts: o.options ?? [] });
    else if (o.type === 2) for (const s of o.options ?? []) out.push({ command: name, group: o.name, sub: s.name, opts: s.options ?? [] });
  }
  return out;
}

/** Valid sample arguments for the REQUIRED options of a leaf. */
function sample(opts: Opt[]): { options: Record<string, string | number | boolean>; users: Record<string, { id: string; username: string }> } {
  const options: Record<string, string | number | boolean> = {}, users: Record<string, { id: string; username: string }> = {};
  for (const o of opts) {
    if (!o.required) continue;
    if (o.type === 6) users[o.name] = { id: 'other-user-1', username: 'Other' };
    else if (o.type === 3) options[o.name] = o.choices?.length ? String(o.choices[0]!.value) : /amount|bet|price|count/i.test(o.name) ? '1' : /name|tag/i.test(o.name) ? 'Test' : 'test';
    else if (o.type === 4 || o.type === 10) options[o.name] = o.choices?.length ? Number(o.choices[0]!.value) : Math.max(1, o.min_value ?? 1);
    else if (o.type === 5) options[o.name] = false;
  }
  return { options, users };
}

// Games that wait on button presses (a real message component) can't be driven by a fake interaction.
const NEEDS_BUTTONS = new Set(['blackjack', 'poker', 'mines', 'ladder', 'towers', 'higherlower', 'crash', 'plinko', 'scratch', 'roulette', 'highroll', 'slots', 'jackpot']);

async function invoke(l: Leaf, userId: string) {
  const cmd = commands.get(l.command)!;
  const { options, users } = sample(l.opts);
  const fi = fakeInteraction({ guildId: null, userId, options, users, group: l.group, sub: l.sub ?? undefined });
  const errors: string[] = [];
  const orig = console.error; console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ').slice(0, 300)); };
  let thrown: unknown = null;
  try { await cmd.run!(fi.interaction); } catch (e) { thrown = e; } finally { console.error = orig; }
  return { fi, errors, thrown, text: fi.sent.map(textOf).join('\n') };
}

let n = 0;
const uid = () => `dm-user-${++n}`;

for (const cmdName of ['eco', 'eco-company']) {
  describe(`/${cmdName} with no guild`, () => {
    const all = leaves(cmdName);
    test(`${all.length} leaves discovered`, () => { expect(all.length).toBeGreaterThan(5); });
    test('every leaf that doesn\'t need real buttons responds without crashing', async () => {
      const u = uid();
      await invoke({ command: 'eco', group: null, sub: 'daily', opts: [] }, u); // give the user some cash first
      const bad: string[] = [];
      for (const l of all) {
        if (NEEDS_BUTTONS.has(l.sub ?? '')) continue;
        const r = await invoke(l, u);
        const path = `/${l.command} ${l.group ?? ''} ${l.sub ?? ''}`.replace(/\s+/g, ' ');
        if (r.thrown) bad.push(`${path} THREW ${(r.thrown as Error).message?.slice(0, 160)}`);
        else if (r.errors.length) bad.push(`${path} logged ${r.errors[0]}`);
        else if (!r.fi.sent.length && !r.fi.deferFlags() && !r.fi.interaction.deferred) bad.push(`${path} sent nothing`);
        else if (/went wrong|There was an error|Cannot read|is not a function/i.test(r.text)) bad.push(`${path} said: ${r.text.slice(0, 120)}`);
      }
      expect(bad, bad.join('\n')).toEqual([]);
    });
  });
}

describe('other commands with no guild', () => {
  test('lookups/tools/fun that need no network', async () => {
    const cases: [string, string | null, string | null, Record<string, string | number>][] = [
      ['math', null, null, { expression: '2+2' }], ['color', null, 'inspect', { query: 'coral' }], ['qr', null, 'generate', { text: 'hi' }], ['asciify', null, null, { text: 'hi' }],
      ['ship', null, null, {}], ['juul', null, 'hit', {}], ['juul', null, 'stats', {}], ['rate', null, null, { thing: 'pizza' }], ['say', null, null, { message: 'hello' }],
      ['about', null, null, {}], ['help', null, null, {}],
      ['8ball', null, null, { question: 'will it work?' }], ['base64', null, null, { action: 'encode', text: 'hello' }], ['ping', null, null, {}],
    ];
    for (const [name, group, sub, options] of cases) {
      const users = name === 'ship' ? { user1: { id: 'a1', username: 'A' }, user2: { id: 'b1', username: 'B' } } : undefined;
      const cmd = commands.get(name)!;
      const fi = fakeInteraction({ guildId: null, options, users, group, sub: sub ?? undefined });
      (fi.interaction as any).client = { user: { id: '1', username: 'Bestow', displayAvatarURL: () => 'https://x/y.png' }, guilds: { cache: { size: 0 } }, ws: { ping: 1 } };
      const errors: string[] = []; const orig = console.error; console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };
      try { await cmd.run!(fi.interaction); } finally { console.error = orig; }
      expect(errors, `/${name} ${sub ?? ''}`).toEqual([]); expect(fi.sent.length, `/${name} sent nothing`).toBeGreaterThan(0);
    }
  });
});
