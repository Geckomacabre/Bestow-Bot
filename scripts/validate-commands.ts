/**
 * Loads every command exactly like the bot does and checks Discord's registration limits,
 * so a bad command fails here instead of at 3am when the bot registers on startup.
 *
 *   bun run validate            # summary + errors
 *   bun run validate --list     # also print every command path
 */
Bun.env.DB_PATH = ':memory:';
Bun.env.LOG_LEVEL ??= 'warn';
Bun.env.TOKEN = 'validate';
Bun.env.CLIENT_ID = '1';

const { default: commands } = await import('../src/handlers/commandHandler');

const LIMITS = { topLevel: 100, options: 25, payloadChars: 8000, message: 5, user: 5 };
const errors: string[] = [];
const warn: string[] = [];
const paths: string[] = [];

type Opt = {
  type: number; name: string; description?: string; options?: Opt[]; choices?: unknown[]; required?: boolean; autocomplete?: boolean;
  min_value?: number; max_value?: number; min_length?: number; max_length?: number;
};
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
  if (json.type === 2) { user++; if (!cmd.runUser) errors.push(`${name}: user menu without runUser()`); continue; }
  if (json.type === 3) { message++; if (!cmd.runMessage) errors.push(`${name}: message menu without runMessage()`); continue; }
  slash++;
  if (typeof cmd.run !== 'function') errors.push(`/${name}: missing run()`);

  const size = count(json);
  if (size > LIMITS.payloadChars) errors.push(`/${name}: payload ${size} chars (limit ${LIMITS.payloadChars})`);
  else if (size > LIMITS.payloadChars * 0.85) warn.push(`/${name}: payload ${size} chars is close to the ${LIMITS.payloadChars} limit`);

  const walk = (opts: Opt[] | undefined, prefix: string, depth = 0) => {
    if (!opts) return;
    if (opts.length > LIMITS.options) errors.push(`${prefix}: ${opts.length} options (limit ${LIMITS.options})`);

    // Rules Discord enforces when registering — a violation makes the WHOLE registration request fail, taking every command down with it.
    const names = new Set<string>();
    for (const o of opts) {
      if (names.has(o.name)) errors.push(`${prefix}: duplicate option/subcommand name "${o.name}"`);
      names.add(o.name);
    }
    let sawOptional = false;
    for (const o of opts.filter(x => x.type > 2)) {
      if (o.required) { if (sawOptional) errors.push(`${prefix}: required option "${o.name}" comes after an optional one (Discord rejects this)`); }
      else sawOptional = true;
      const ch = (o.choices ?? []) as { name: string; value: unknown }[];
      if (ch.length > 25) errors.push(`${prefix} ${o.name}: ${ch.length} choices (limit 25)`);
      if (ch.length && o.autocomplete) errors.push(`${prefix} ${o.name}: has both choices and autocomplete (not allowed)`);
      for (const c of ch) {
        if (!c.name || c.name.length > 100) errors.push(`${prefix} ${o.name}: choice name "${String(c.name).slice(0, 20)}…" must be 1–100 chars`);
        if (typeof c.value === 'string' && (c.value.length < 1 || c.value.length > 100)) errors.push(`${prefix} ${o.name}: choice value for "${c.name}" must be 1–100 chars`);
      }
      if (o.min_value != null && o.max_value != null && o.min_value > o.max_value) errors.push(`${prefix} ${o.name}: min_value > max_value`);
      if (o.min_length != null && o.max_length != null && o.min_length > o.max_length) errors.push(`${prefix} ${o.name}: min_length > max_length`);
      if (o.max_length != null && (o.max_length < 1 || o.max_length > 6000)) errors.push(`${prefix} ${o.name}: max_length must be 1–6000`);
    }
    for (const o of opts) {
      if (o.type === 1 || o.type === 2) {
        const p = `${prefix} ${o.name}`;
        if (o.type === 2 && depth >= 1) errors.push(`${p}: subcommand groups can't be nested`);
        if (o.type === 2 && (o.options ?? []).some(x => x.type !== 1)) errors.push(`${p}: a subcommand group may contain only subcommands`);
        if (o.type === 2 && !(o.options ?? []).length) errors.push(`${p}: empty subcommand group`);
        if (o.type === 1) { subs++; paths.push(`/${p.slice(1)}`); if ((o.options ?? []).some(x => x.type <= 2)) errors.push(`${p}: a subcommand can only contain plain options`); }
        walk(o.options, p, depth + (o.type === 2 ? 1 : 0));
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
