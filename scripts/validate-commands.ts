/**
 * Loads every command exactly like the bot does and checks Discord's registration limits,
 * so a bad command fails here instead of at 3am when the bot registers on startup.
 *
 *   bun run validate            # summary + errors
 *   bun run validate --list     # also print every command path
 */
Bun.env.DB_PATH ??= ':memory:';
Bun.env.LOG_LEVEL ??= 'warn';
Bun.env.TOKEN ??= 'validate';
Bun.env.CLIENT_ID ??= '1';
Bun.env.GUILD_ID ??= '1';

const { default: commands } = await import('../src/handlers/commandHandler');

const LIMITS = { topLevel: 100, options: 25, payloadChars: 8000, message: 5, user: 5 };
const errors: string[] = [];
const warn: string[] = [];
const paths: string[] = [];

type Opt = { type: number; name: string; description?: string; options?: Opt[]; choices?: unknown[] };
type Json = { name: string; type?: number; description?: string; options?: Opt[] };

/**
 * Discord's "8000 characters" limit counts only the name + description of the command, every
 * option/subcommand/group, and each choice's name + string value — not JSON syntax.
 */
function count(o: Opt | Json | { name: string; value?: unknown }): number {
  const x = o as { name?: string; description?: string; value?: unknown; options?: Opt[]; choices?: { name: string; value: unknown }[] };
  let n = (x.name?.length ?? 0) + (x.description?.length ?? 0) + (typeof x.value === 'string' ? x.value.length : 0);
  for (const c of x.choices ?? []) n += count(c);
  for (const s of x.options ?? []) n += count(s);
  return n;
}

const byCategory = new Map<string, number>();
let message = 0, user = 0, slash = 0, subs = 0;

for (const [name, cmd] of commands) {
  const json = cmd.data.toJSON() as Json;
  byCategory.set(cmd.category ?? '?', (byCategory.get(cmd.category ?? '?') ?? 0) + 1);

  if (json.name !== name) errors.push(`/${name}: registered under a different name (${json.name})`);
  if (json.type === 2) { user++; if (!cmd.runMessage && !cmd.run) errors.push(`${name}: user menu without handler`); continue; }
  if (json.type === 3) { message++; if (!cmd.runMessage) errors.push(`${name}: message menu without runMessage()`); continue; }
  slash++;
  if (typeof cmd.run !== 'function') errors.push(`/${name}: missing run()`);

  const size = count(json);
  if (size > LIMITS.payloadChars) errors.push(`/${name}: payload ${size} chars (limit ${LIMITS.payloadChars})`);
  else if (size > LIMITS.payloadChars * 0.85) warn.push(`/${name}: payload ${size} chars is close to the ${LIMITS.payloadChars} limit`);

  const walk = (opts: Opt[] | undefined, prefix: string) => {
    if (!opts) return;
    if (opts.length > LIMITS.options) errors.push(`${prefix}: ${opts.length} options (limit ${LIMITS.options})`);
    for (const o of opts) {
      if (o.type === 1 || o.type === 2) {
        const p = `${prefix} ${o.name}`;
        if (o.type === 1) { subs++; paths.push(`/${p.slice(1)}`); }
        walk(o.options, p);
      }
    }
  };
  const hasSubs = json.options?.some(o => o.type === 1 || o.type === 2);
  if (!hasSubs) paths.push(`/${name}`);
  walk(json.options, `/${name}`.slice(0));
  // A command can't mix plain options with subcommands.
  if (hasSubs && json.options!.some(o => o.type !== 1 && o.type !== 2)) errors.push(`/${name}: mixes subcommands with plain options`);
}

if (commands.size > LIMITS.topLevel) errors.push(`${commands.size} top-level commands (Discord limit ${LIMITS.topLevel})`);
if (message > LIMITS.message) errors.push(`${message} message context menus (limit ${LIMITS.message})`);
if (user > LIMITS.user) errors.push(`${user} user context menus (limit ${LIMITS.user})`);

console.log(`\nTop-level: ${commands.size}/${LIMITS.topLevel}  (slash ${slash}, message menus ${message}/${LIMITS.message}, user menus ${user}/${LIMITS.user})`);
console.log(`Invocable paths: ${paths.length}  (of which subcommands: ${subs})`);
console.log('By category:', [...byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  '));
if (Bun.argv.includes('--list')) console.log('\n' + paths.sort().join('\n'));
if (warn.length) console.log('\nWarnings:\n  ' + warn.join('\n  '));
if (errors.length) {
  console.error('\nERRORS:\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('\n✔ All commands valid.');
process.exit(0);
