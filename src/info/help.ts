import type { Command } from '../interfaces/command.js';

/** Pure helpers behind /help: turn the loaded command registry into readable text. */

export interface HelpEntry { path: string; description: string; options: string[] }
export interface HelpCmd { name: string; description: string; category: string; entries: HelpEntry[] }

const LABELS: Record<string, string> = {
  eco: '💰 Economy', economy: '💰 Economy settings', media: '🎬 Media & voice', lookups: '🔎 Lookups & tools', fun: '🎉 Fun', random: '🎲 Random', utility: '🧰 Utility', moderation: '🛡️ Moderation',
  levels: '📈 Levels', mediaguess: '🎯 Guessing games', birthday: '🎂 Birthdays', reputation: '⭐ Reputation', roles: '🏷️ Roles', config: '⚙️ Config', image: '🖼️ Images', reminders: '⏰ Reminders',
  streamvc: '📺 Stream VC', tags: '📌 Tags', tickets: '🎫 Tickets', privacy: '🔒 Privacy', info: 'ℹ️ Info', ai: '🤖 AI', generate: '🧪 Generate',
};
export const categoryLabel = (c: string) => LABELS[c] ?? `${c[0]?.toUpperCase() ?? ''}${c.slice(1)}`;

interface RawOpt { type: number; name: string; description: string; required?: boolean; options?: RawOpt[] }

export function toHelp(cmds: Iterable<Command>): HelpCmd[] {
  const out: HelpCmd[] = [];
  for (const c of cmds) {
    const j = c.data.toJSON() as { name: string; description?: string; type?: number; options?: RawOpt[] };
    if (j.type && j.type !== 1) continue; // context-menu commands aren't slash commands
    const entries: HelpEntry[] = [];
    const args = (o?: RawOpt[]) => (o ?? []).filter(x => x.type > 2).map(x => (x.required ? `<${x.name}>` : `[${x.name}]`));
    for (const o of j.options ?? []) {
      if (o.type === 2) for (const s of o.options ?? []) entries.push({ path: `${j.name} ${o.name} ${s.name}`, description: s.description, options: args(s.options) });
      else if (o.type === 1) entries.push({ path: `${j.name} ${o.name}`, description: o.description, options: args(o.options) });
    }
    if (!entries.length) entries.push({ path: j.name, description: j.description ?? '', options: args(j.options) });
    out.push({ name: j.name, description: j.description ?? '', category: c.category ?? 'misc', entries });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const MAX = 3200; // stays under card()'s description limit
const clip = (s: string) => (s.length <= MAX ? s : `${s.slice(0, MAX - 20).replace(/\n[^\n]*$/, '')}\n…and more`);

export function overview(list: HelpCmd[]): string {
  const byCat = new Map<string, HelpCmd[]>();
  for (const c of list) byCat.set(c.category, [...(byCat.get(c.category) ?? []), c]);
  const lines = [...byCat.entries()].sort((a, b) => categoryLabel(a[0]).localeCompare(categoryLabel(b[0]))).map(([cat, cs]) => {
    const names = cs.slice(0, 10).map(c => `\`/${c.name}\``).join(' ');
    return `**${categoryLabel(cat)}** — ${cs.length} command${cs.length === 1 ? '' : 's'}\n${names}${cs.length > 10 ? ` +${cs.length - 10} more` : ''}`;
  });
  return clip(`${lines.join('\n\n')}\n\n-# Try \`/help <command>\` (e.g. \`/help tools\`) or \`/help <category>\` for details.`);
}

export function categoryView(list: HelpCmd[], cat: string): string | undefined {
  const cs = list.filter(c => c.category === cat);
  if (!cs.length) return undefined;
  return clip(`**${categoryLabel(cat)}**\n${cs.map(c => `\`/${c.name}\` — ${c.description}${c.entries.length > 1 ? ` *(${c.entries.length} subcommands)*` : ''}`).join('\n')}`);
}

export function commandView(list: HelpCmd[], name: string): string | undefined {
  const c = list.find(x => x.name === name.replace(/^\//, '').toLowerCase());
  if (!c) return undefined;
  const lines = c.entries.map(e => `\`/${e.path}${e.options.length ? ` ${e.options.join(' ')}` : ''}\`${e.description ? ` — ${e.description}` : ''}`);
  return clip(`**/${c.name}** — ${c.description}\n${lines.join('\n')}`);
}

/** Categories and commands whose names contain the query, for autocomplete (max 25). */
export function suggestions(list: HelpCmd[], q: string): { name: string; value: string }[] {
  const s = q.trim().toLowerCase().replace(/^\//, '');
  const cats = [...new Set(list.map(c => c.category))].map(c => ({ name: `Category: ${categoryLabel(c)}`, value: c, key: `${c} ${categoryLabel(c).toLowerCase()}` }));
  const cmds = list.map(c => ({ name: `/${c.name} — ${c.description}`.slice(0, 100), value: c.name, key: c.name }));
  return [...cats, ...cmds].filter(x => !s || x.key.includes(s)).slice(0, 25).map(({ name, value }) => ({ name, value }));
}

/** Resolve a /help query to text: a category or a command; falls back to a fuzzy "did you mean". */
export function helpFor(list: HelpCmd[], query: string | null): { text: string; found: boolean } {
  if (!query?.trim()) return { text: overview(list), found: true };
  const q = query.trim().toLowerCase().replace(/^\//, '');
  const first = q.split(/\s+/)[0]!;
  const v = commandView(list, first) ?? categoryView(list, q);
  if (v) return { text: v, found: true };
  const near = list.filter(c => c.name.includes(first) || c.entries.some(e => e.path.includes(q))).slice(0, 8);
  return { found: false, text: near.length ? `No command called \`${q.slice(0, 40)}\`. Did you mean: ${near.map(c => `\`/${c.name}\``).join(', ')}?` : `No command or category called \`${q.slice(0, 40)}\`. Run \`/help\` for the full list.` };
}
