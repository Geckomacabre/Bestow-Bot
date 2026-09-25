/**
 * Prints Heist's own description and options for the commands under a prefix, from the raw list at https://status.heist.lol/api/commands.
 *   bun scripts/heist-spec.ts "eco wallet-edit"     (needs docs/heist-spec.json; refresh it with --fetch)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const file = path.resolve(import.meta.dir, '../docs/heist-spec.json');
interface Arg { name: string; description: string; type: string; required: boolean; choices: unknown[] }
interface Spec { path: string; description: string; premium: boolean; cog: string; args: Arg[] }

if (Bun.argv.includes('--fetch')) {
  const raw = (await (await fetch('https://status.heist.lol/api/commands')).json()) as { commands: { name: string; description: string; type: string; cog: string; is_premium: boolean; arguments: Arg[] }[] };
  const specs: Spec[] = raw.commands.filter(c => c.type !== 'group' && c.cog !== 'Staff').map(c => ({ path: c.name, description: c.description, premium: c.is_premium, cog: c.cog, args: c.arguments.map(a => ({ name: a.name, description: a.description, type: a.type, required: a.required, choices: a.choices })) }));
  writeFileSync(file, JSON.stringify(specs, null, 1) + '\n');
  console.log(`saved ${specs.length}`);
} else {
  const prefix = Bun.argv[2] ?? '';
  for (const s of JSON.parse(readFileSync(file, 'utf8')) as Spec[]) {
    if (!s.path.startsWith(prefix)) continue;
    console.log(`${s.premium ? '✨ ' : ''}${s.path} — ${s.description}`);
    for (const a of s.args) console.log(`     ${a.required ? '*' : ' '}${a.name}:${a.type}${a.choices.length ? ` [${a.choices.map((c: any) => c.name ?? c).join('|')}]` : ''} — ${a.description}`);
  }
}
