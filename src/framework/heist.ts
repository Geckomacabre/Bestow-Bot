import { ChannelType, type ChatInputCommandInteraction, type SlashCommandSubcommandBuilder } from 'discord.js';
import raw from '../../docs/heist-spec.json' with { type: 'json' };
import { defineGroup, defineLeaf, type GroupDef, type Sub, type SubGroup } from './group.js';
import type { Command } from '../interfaces/command.js';

/**
 * Commands built straight from Heist's own command list (docs/heist-spec.json, from https://status.heist.lol/api/commands),
 * so every name, description, option, type, required flag and choice is exactly Heist's. Handlers only supply behaviour.
 * tests/parity.test.ts compares the registered commands against the spec and fails on any drift.
 */

export interface SpecArg { name: string; description: string; type: string; required: boolean; choices: string[] }
export interface Spec { path: string; description: string; premium: boolean; cog: string; args: SpecArg[] }

export const SPEC = raw as Spec[];
const BY_PATH = new Map(SPEC.map(s => [s.path, s]));

/** Heist → this bot's name in any user-facing text taken from the spec. */
export const rebrand = (s: string) => s.replace(/\bHeist\b/g, 'Bestow');

export function heistSpec(path: string): Spec {
  const s = BY_PATH.get(path);
  if (!s) throw new Error(`[heist] no Heist command "${path}" in docs/heist-spec.json`);
  return s;
}

/** A command/sub description as Bestow registers it: rebranded, with the ✨ that marks Premium left to the premium flag. */
export function specDescription(s: Pick<Spec, 'description' | 'premium'>): string {
  const d = rebrand(s.description).trim();
  return s.premium ? d.replace(/^✨\s?/, '') : d;
}

/** Descriptions Heist's list truncated to "…": a readable one from the option name. */
const FALLBACK: Record<string, string> = {
  username: 'Username', user: 'The user', amount: 'Amount (a number, "all" or "half")', card_id: 'Card ID', category: 'Card category', stars: 'Star level',
  price: 'Price', name: 'Name', tag: 'Tag', description: 'Description', privacy: 'Privacy', text: 'Text', size: 'Size', degrees: 'Degrees',
  assetid: 'Asset ID', game: 'Game', shape: 'Shape', rounds: 'Rounds', your_card_id: 'Your card ID', their_card_id: 'Their card ID',
  url: 'URL', quality: 'Quality', audio: 'Audio', format: 'Format',
};
export function argDescription(a: Pick<SpecArg, 'name' | 'description'>): string {
  const d = a.description.trim();
  if (d && d !== '…' && d !== '...') return rebrand(d).slice(0, 100);
  return FALLBACK[a.name] ?? a.name.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}

/**
 * The value a choice is registered with. Heist's list only has choice names, so: strings use the name itself; integers/numbers
 * use the number a name starts with ("144p" → 144, "90°" → 90, "1 - Loud" → 1, "0.5x (slow)" → 0.5) or else the choice's position.
 */
export function choiceValue(type: string, name: string, index: number): string | number {
  if (type === 'string') return name.slice(0, 100);
  const m = /^(\d+(?:\.\d+)?)/.exec(name);
  if (m) return type === 'integer' ? Math.trunc(Number(m[1])) : Number(m[1]);
  return index;
}

export interface OptTweak {
  /** Replaces a truncated Heist description. */
  description?: string;
  min?: number; max?: number; minLength?: number; maxLength?: number;
  autocomplete?: boolean;
  channelTypes?: ChannelType[];
  /** Heist choices Bestow deliberately doesn't offer (each must be listed with a reason in docs/heist-parity.json → declinedChoices). */
  skipChoices?: string[];
}

/** Adds the options of a Heist command, in Heist's order, to a subcommand (or leaf command) builder. */
export function applySpecArgs(b: SlashCommandSubcommandBuilder, args: SpecArg[], tweaks: Record<string, OptTweak> = {}): SlashCommandSubcommandBuilder {
  for (const a of args) {
    const t = tweaks[a.name] ?? {};
    const desc = t.description ?? argDescription(a);
    const base = <T extends { setName(n: string): T; setDescription(d: string): T; setRequired(r: boolean): T }>(o: T) => o.setName(a.name).setDescription(desc).setRequired(a.required);
    const choices = a.choices.map((c, n) => ({ name: String(c).slice(0, 100), value: choiceValue(a.type, String(c), n) }))
      .filter(c => !t.skipChoices?.includes(c.name));
    switch (a.type) {
      case 'string':
        b.addStringOption(o => {
          base(o);
          if (choices.length) o.addChoices(...(choices as { name: string; value: string }[]));
          else if (t.autocomplete) o.setAutocomplete(true);
          if (t.minLength != null) o.setMinLength(t.minLength);
          if (t.maxLength != null) o.setMaxLength(t.maxLength);
          return o;
        });
        break;
      case 'integer':
        b.addIntegerOption(o => {
          base(o);
          if (choices.length) o.addChoices(...(choices as { name: string; value: number }[]));
          else if (t.autocomplete) o.setAutocomplete(true);
          if (t.min != null) o.setMinValue(t.min);
          if (t.max != null) o.setMaxValue(t.max);
          return o;
        });
        break;
      case 'number':
        b.addNumberOption(o => {
          base(o);
          if (choices.length) o.addChoices(...(choices as { name: string; value: number }[]));
          if (t.min != null) o.setMinValue(t.min);
          if (t.max != null) o.setMaxValue(t.max);
          return o;
        });
        break;
      case 'boolean': b.addBooleanOption(o => base(o)); break;
      case 'user': b.addUserOption(o => base(o)); break;
      case 'role': b.addRoleOption(o => base(o)); break;
      case 'mentionable': b.addMentionableOption(o => base(o)); break;
      case 'attachment': b.addAttachmentOption(o => base(o)); break;
      case 'channel': b.addChannelOption(o => { base(o); if (t.channelTypes?.length) o.addChannelTypes(...(t.channelTypes as never[])); return o; }); break;
      default: throw new Error(`[heist] unsupported option type "${a.type}" (${a.name})`);
    }
  }
  return b;
}

type RunFn = (i: ChatInputCommandInteraction) => Promise<unknown>;
export interface HsubOpts extends Pick<Sub, 'autocomplete' | 'permissions' | 'guildOnly'> {
  tweaks?: Record<string, OptTweak>;
  /** Premium even though Heist's list doesn't mark it (rare; default: Heist's flag). */
  premium?: boolean;
}

/** A subcommand defined by Heist's spec for `path`; the sub's name is the last path segment. */
export function hsub(path: string, run: RunFn, o: HsubOpts = {}): Sub {
  const s = heistSpec(path);
  return {
    name: path.split(' ').at(-1)!,
    description: specDescription(s),
    options: b => applySpecArgs(b, s.args, o.tweaks),
    run,
    autocomplete: o.autocomplete,
    permissions: o.permissions,
    guildOnly: o.guildOnly,
    premium: o.premium ?? s.premium,
  };
}

/** A top-level Heist command with no subcommands (`/steam`, `/rate`, `/gif` …). */
export function hleaf(path: string, run: RunFn, o: HsubOpts & { scope?: 'guild' | 'anywhere' } = {}): Command {
  return defineLeaf(hsub(path, run, o), { scope: o.scope });
}

/** A top-level Heist command made of subs/groups; its description comes from the spec when Heist lists one. */
export function hgroup(def: Omit<GroupDef, 'description'> & { description?: string; subs?: Sub[]; groups?: SubGroup[] }): Command {
  const s = BY_PATH.get(def.name);
  return defineGroup({ ...def, description: def.description ?? (s ? specDescription(s) : def.name) });
}

/** A string choice's value (the choice name) — or null when the option wasn't given. */
export const choice = (i: ChatInputCommandInteraction, name: string) => i.options.getString(name);

const GETTERS = new Set(['get', 'getString', 'getInteger', 'getNumber', 'getBoolean', 'getUser', 'getMember', 'getAttachment', 'getChannel', 'getRole', 'getMentionable', 'getFocused']);

/**
 * Presents Heist's option names under the names an existing handler asks for: with `{ term: 'search' }`, a handler calling
 * `getString('term')` reads the registered `search` option. Lets a handler written before the rename run unchanged.
 */
export function aliasOptions<T extends ChatInputCommandInteraction>(i: T, alias: Record<string, string>): T {
  const bind = (target: object, prop: string | symbol) => { const v = Reflect.get(target, prop, target); return typeof v === 'function' ? v.bind(target) : v; };
  const opts = new Proxy(i.options as object, {
    get(target, prop) {
      const fn = bind(target, prop);
      if (typeof prop !== 'string' || !GETTERS.has(prop) || typeof fn !== 'function') return fn;
      return (name: unknown, ...rest: unknown[]) => fn(typeof name === 'string' ? (alias[name] ?? name) : name, ...rest);
    },
  });
  return new Proxy(i as object, { get(target, prop) { return prop === 'options' ? opts : bind(target, prop); } }) as T;
}

/** Re-mount an existing handler at a Heist path with Heist's options (`alias` maps the handler's old option names to Heist's). */
export function hfrom(path: string, sub: Pick<Sub, 'run' | 'autocomplete'>, o: HsubOpts & { alias?: Record<string, string> } = {}): Sub {
  const alias = o.alias ?? {};
  return hsub(path, i => sub.run(aliasOptions(i, alias)), { autocomplete: sub.autocomplete, ...o });
}
