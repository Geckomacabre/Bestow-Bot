/**
 * Heist parity ledger.
 *   bun scripts/parity.ts              → print what is missing and every command whose options differ from Heist's
 *   bun scripts/parity.ts --write      → refresh `notYet` in docs/heist-parity.json from the live registry
 *
 * docs/heist-commands.json  = snapshot of Heist's public commands (paths).
 * docs/heist-spec.json      = Heist's full definitions (descriptions, options, choices) from https://status.heist.lol/api/commands.
 * docs/heist-parity.json    = { declined: { "<path>": "<reason>" }, declinedChoices: { "<path> <option>": { "<choice>": "<reason>" } }, notYet: ["<path>"] }
 * tests/parity.test.ts fails if a Heist command is neither built, declined (with a reason), nor listed in notYet, if notYet has stale
 * entries, or if a built command's options/description differ from Heist's.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface HeistCmd { path: string; type: 'slash' | 'user' | 'message'; cog: string; premium: boolean }
export interface Parity { declined: Record<string, string>; declinedChoices?: Record<string, Record<string, string>>; notYet: string[] }
interface SpecArg { name: string; description: string; type: string; required: boolean; choices: string[] }
interface Spec { path: string; description: string; premium: boolean; args: SpecArg[] }
interface Opt { type: number; name: string; description: string; required?: boolean; choices?: { name: string }[]; options?: Opt[] }

const root = path.resolve(import.meta.dir, '..');
export const heist = (JSON.parse(readFileSync(path.join(root, 'docs/heist-commands.json'), 'utf8')) as { commands: HeistCmd[] }).commands;
export const spec = JSON.parse(readFileSync(path.join(root, 'docs/heist-spec.json'), 'utf8')) as Spec[];
export const readParity = (): Parity => JSON.parse(readFileSync(path.join(root, 'docs/heist-parity.json'), 'utf8'));

const TYPE: Record<number, string> = { 3: 'string', 4: 'integer', 10: 'number', 5: 'boolean', 6: 'user', 7: 'channel', 8: 'role', 9: 'mentionable', 11: 'attachment' };

async function registry() {
  Bun.env.DB_PATH = ':memory:'; Bun.env.LOG_LEVEL = 'warn'; Bun.env.TOKEN ??= 'parity'; Bun.env.CLIENT_ID ??= '1';
  return (await import('../src/handlers/commandHandler')).default;
}

/** Every slash path (with its description and options) and context-menu name the bot actually registers. */
export async function ourCommands(): Promise<{ slash: Map<string, { description: string; options: Opt[] }>; user: Set<string>; message: Set<string> }> {
  const out = { slash: new Map<string, { description: string; options: Opt[] }>(), user: new Set<string>(), message: new Set<string>() };
  for (const [name, cmd] of await registry()) {
    const j = cmd.data.toJSON() as { type?: number; description: string; options?: Opt[] };
    if (j.type === 2) { out.user.add(name); continue; }
    if (j.type === 3) { out.message.add(name); continue; }
    const opts = j.options ?? [];
    if (!opts.some(o => o.type === 1 || o.type === 2)) { out.slash.set(name, { description: j.description, options: opts }); continue; }
    for (const o of opts) {
      if (o.type === 1) out.slash.set(`${name} ${o.name}`, { description: o.description, options: o.options ?? [] });
      else if (o.type === 2) for (const s of o.options ?? []) out.slash.set(`${name} ${o.name} ${s.name}`, { description: s.description, options: s.options ?? [] });
    }
  }
  return out;
}
/** Back-compat: just the path sets. */
export async function ourPaths() { const o = await ourCommands(); return { slash: new Set(o.slash.keys()), user: o.user, message: o.message }; }

const menuName = (p: string) => p.replace(/^✨\s*/, '');

export async function missing(): Promise<HeistCmd[]> {
  const ours = await ourCommands();
  const declined = readParity().declined;
  return heist.filter(h => !declined[h.path] && !(h.type === 'slash' ? ours.slash.has(h.path) : ours[h.type].has(menuName(h.path))));
}

const rebrand = (s: string) => s.replace(/\bHeist\b/g, 'Bestow');
const shapeOfSpec = (a: SpecArg, skip: Record<string, string>) =>
  `${a.name}${a.required ? '' : '?'}:${a.type}${a.choices.length ? `[${a.choices.filter(c => !skip[c]).join('|')}]` : ''}`;
const shapeOfOpt = (o: Opt) => `${o.name}${o.required ? '' : '?'}:${TYPE[o.type]}${o.choices?.length ? `[${o.choices.map(c => c.name).join('|')}]` : ''}`;
const descOf = (s: Spec) => { const d = rebrand(s.description).trim(); return s.premium ? `✨ ${d.replace(/^✨\s?/, '')}` : d; };

/** Built Heist commands whose description or options differ from Heist's definition. */
export async function drift(): Promise<{ path: string; problems: string[] }[]> {
  const ours = await ourCommands();
  const p = readParity();
  const out: { path: string; problems: string[] }[] = [];
  for (const s of spec) {
    const mine = ours.slash.get(s.path);
    if (!mine || p.declined[s.path]) continue;
    const problems: string[] = [];
    if (mine.description !== descOf(s)) problems.push(`description: heist "${descOf(s)}" · ours "${mine.description}"`);
    const want = s.args.map(a => shapeOfSpec(a, p.declinedChoices?.[`${s.path} ${a.name}`] ?? {})).join(' ');
    const got = mine.options.map(shapeOfOpt).join(' ');
    if (want !== got) problems.push(`options: heist ${want || '(none)'} · ours ${got || '(none)'}`);
    if (problems.length) out.push({ path: s.path, problems });
  }
  return out;
}

if (import.meta.main) {
  const m = await missing();
  if (Bun.argv.includes('--write')) {
    const p = readParity();
    p.notYet = m.map(c => c.path).sort();
    writeFileSync(path.join(root, 'docs/heist-parity.json'), JSON.stringify(p, null, 1) + '\n');
    console.log(`notYet updated: ${p.notYet.length}`);
  } else {
    const by: Record<string, string[]> = {};
    for (const c of m) (by[c.cog] ??= []).push(`${c.type === 'slash' ? '/' : `[${c.type}] `}${c.path}`);
    for (const [k, v] of Object.entries(by)) console.log(`\n## ${k} (${v.length})\n${v.join('\n')}`);
    const d = await drift();
    if (d.length) console.log(`\n## Differs from Heist (${d.length})\n${d.map(x => `/${x.path}\n  ${x.problems.join('\n  ')}`).join('\n')}`);
    console.log(`\n${m.length} of ${heist.length} Heist commands not yet built (${Object.keys(readParity().declined).length} declined); ${d.length} built ones differ from Heist.`);
  }
  process.exit(0);
}
