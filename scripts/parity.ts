/**
 * Heist parity ledger.
 *   bun scripts/parity.ts              → print what is missing (and the plan for it)
 *   bun scripts/parity.ts --write      → refresh `notYet` in docs/heist-parity.json from the live registry
 *
 * docs/heist-commands.json  = snapshot of Heist's public commands.
 * docs/heist-parity.json    = { declined: { "<path>": "<reason>" }, notYet: ["<path>"] }
 * tests/parity.test.ts fails if a Heist command is neither built, declined (with a reason), nor listed in notYet — and if notYet has stale entries.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface HeistCmd { path: string; type: 'slash' | 'user' | 'message'; cog: string; premium: boolean }
export interface Parity { declined: Record<string, string>; notYet: string[] }

const root = path.resolve(import.meta.dir, '..');
export const heist = (JSON.parse(readFileSync(path.join(root, 'docs/heist-commands.json'), 'utf8')) as { commands: HeistCmd[] }).commands;
export const readParity = (): Parity => JSON.parse(readFileSync(path.join(root, 'docs/heist-parity.json'), 'utf8'));

/** Every slash path and context-menu name the bot actually registers. */
export async function ourPaths(): Promise<{ slash: Set<string>; user: Set<string>; message: Set<string> }> {
  Bun.env.DB_PATH = ':memory:'; Bun.env.LOG_LEVEL = 'warn'; Bun.env.TOKEN = 'parity'; Bun.env.CLIENT_ID = '1';
  const commands = (await import('../src/handlers/commandHandler')).default;
  const out = { slash: new Set<string>(), user: new Set<string>(), message: new Set<string>() };
  for (const [name, cmd] of commands) {
    const j = cmd.data.toJSON() as { type?: number; options?: { type: number; name: string; options?: { type: number; name: string }[] }[] };
    if (j.type === 2) { out.user.add(name); continue; }
    if (j.type === 3) { out.message.add(name); continue; }
    const opts = j.options ?? [];
    if (!opts.some(o => o.type === 1 || o.type === 2)) { out.slash.add(name); continue; }
    for (const o of opts) {
      if (o.type === 1) out.slash.add(`${name} ${o.name}`);
      else if (o.type === 2) for (const s of o.options ?? []) out.slash.add(`${name} ${o.name} ${s.name}`);
    }
  }
  return out;
}

export async function missing(): Promise<HeistCmd[]> {
  const ours = await ourPaths();
  const declined = readParity().declined;
  return heist.filter(h => !declined[h.path] && !ours[h.type].has(h.type === 'slash' ? h.path : h.path.replace(/^✨\s*/, '')));
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
    console.log(`\n${m.length} of ${heist.length} Heist commands not yet built (${Object.keys(readParity().declined).length} declined).`);
  }
  process.exit(0);
}
