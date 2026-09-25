import {
  ApplicationIntegrationType,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionsBitField,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  SlashCommandSubcommandGroupBuilder,
} from 'discord.js';
import type { Command } from '../interfaces/command';
import { PREMIUM_MARK, premiumWall } from '../premium/wall.js';

/**
 * Discord allows only 100 top-level global slash commands, but a command can hold
 * 25 subcommands/groups and each group another 25. defineGroup() lets a category
 * (`/eco`, `/roblox`, `/media` …) be assembled from many small handler modules
 * while staying a single registered command.
 */

/** 'guild' = server-only. 'anywhere' = also usable via user-install, in DMs and group DMs. */
export type Scope = 'guild' | 'anywhere';

type RunFn = (interaction: ChatInputCommandInteraction) => Promise<unknown>;
type AutoFn = (interaction: AutocompleteInteraction) => Promise<unknown>;

export interface Sub {
  name: string;
  description: string;
  /** Add options to this subcommand. */
  options?: (s: SlashCommandSubcommandBuilder) => unknown;
  run: RunFn;
  autocomplete?: AutoFn;
  /**
   * Permissions the invoker must hold. A folded command loses its own `default_member_permissions`
   * (Discord only supports those on the top-level command), so the requirement is enforced here at run time.
   */
  permissions?: bigint;
  /** Refuse outside servers (DMs / user-install). */
  guildOnly?: boolean;
  /** A ✨ Premium command: needs Premium once Premium is on sale (see premium/wall.ts). */
  premium?: boolean;
}

/** Marks subs as Premium commands. */
export const premium = (subs: Sub[]): Sub[] => subs.map(s => ({ ...s, premium: true }));

/** Wraps a sub's handler with its permission / guild-only / premium requirements. */
function guarded(sub: Sub): RunFn {
  if (!sub.permissions && !sub.guildOnly && !sub.premium) return sub.run;
  return async interaction => {
    if (sub.premium && (await premiumWall(interaction))) return;
    if ((sub.guildOnly || sub.permissions) && !interaction.inGuild()) {
      return interaction.reply({ content: '❌ That only works in a server.', flags: MessageFlags.Ephemeral });
    }
    if (sub.permissions && !interaction.memberPermissions?.has(sub.permissions)) {
      const names = new PermissionsBitField(sub.permissions).toArray().map(p => p.replace(/([a-z])([A-Z])/g, '$1 $2').replace('Guild', 'Server')).join(', '); // Discord's UI says "Manage Server"
      return interaction.reply({ content: `❌ You need the **${names}** permission for that.`, flags: MessageFlags.Ephemeral });
    }
    return sub.run(interaction);
  };
}

export interface SubGroup {
  name: string;
  description: string;
  subs: Sub[];
}

export interface GroupDef {
  name: string;
  description: string;
  scope?: Scope;
  /** Default member permissions required to see/use the command (e.g. PermissionFlagsBits.ManageGuild). */
  permissions?: bigint | number;
  /** Subcommands directly under the command. */
  subs?: Sub[];
  /** Subcommand groups (`/name group sub`). */
  groups?: SubGroup[];
}

const NAME_RE = /^[-_\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

function assertName(kind: string, name: string, path: string) {
  if (!NAME_RE.test(name) || name !== name.toLowerCase()) {
    throw new Error(`[defineGroup] invalid ${kind} name "${name}" in ${path} (lowercase, 1-32 chars, letters/numbers/-/_)`);
  }
}

function assertDescription(description: string, path: string) {
  if (!description || description.length > 100) {
    throw new Error(`[defineGroup] description for ${path} must be 1-100 chars (got ${description?.length ?? 0})`);
  }
}

function buildSub(sub: Sub, path: string): SlashCommandSubcommandBuilder {
  assertName('subcommand', sub.name, path);
  const description = sub.premium ? PREMIUM_MARK + sub.description : sub.description;
  assertDescription(description, path);
  const b = new SlashCommandSubcommandBuilder().setName(sub.name).setDescription(description);
  sub.options?.(b);
  return b;
}

export function defineGroup(def: GroupDef): Command {
  assertName('command', def.name, def.name);
  assertDescription(def.description, def.name);

  const subs = def.subs ?? [];
  const groups = def.groups ?? [];
  if (subs.length + groups.length === 0) throw new Error(`[defineGroup] ${def.name} has no subcommands`);
  if (subs.length + groups.length > 25) {
    throw new Error(`[defineGroup] ${def.name} has ${subs.length + groups.length} direct subcommands/groups (max 25)`);
  }

  const scope = def.scope ?? 'anywhere';
  const data = new SlashCommandBuilder().setName(def.name).setDescription(def.description);
  if (scope === 'anywhere') {
    data.setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall]);
    data.setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);
  } else {
    data.setIntegrationTypes([ApplicationIntegrationType.GuildInstall]);
    data.setContexts([InteractionContextType.Guild]);
  }
  if (def.permissions !== undefined) data.setDefaultMemberPermissions(new PermissionsBitField(def.permissions as bigint).bitfield);

  const runMap = new Map<string, RunFn>();
  const autoMap = new Map<string, AutoFn>();
  const seen = new Set<string>();

  for (const sub of subs) {
    if (seen.has(sub.name)) throw new Error(`[defineGroup] duplicate name "${sub.name}" in ${def.name}`);
    seen.add(sub.name);
    data.addSubcommand(buildSub(sub, `${def.name} ${sub.name}`));
    runMap.set(`/${sub.name}`, guarded(sub));
    if (sub.autocomplete) autoMap.set(`/${sub.name}`, sub.autocomplete);
  }

  for (const group of groups) {
    assertName('group', group.name, `${def.name} ${group.name}`);
    assertDescription(group.description, `${def.name} ${group.name}`);
    if (seen.has(group.name)) throw new Error(`[defineGroup] duplicate name "${group.name}" in ${def.name}`);
    seen.add(group.name);
    if (group.subs.length === 0) throw new Error(`[defineGroup] group ${def.name} ${group.name} is empty`);
    if (group.subs.length > 25) throw new Error(`[defineGroup] group ${def.name} ${group.name} has ${group.subs.length} subcommands (max 25)`);

    const g = new SlashCommandSubcommandGroupBuilder().setName(group.name).setDescription(group.description);
    const inGroup = new Set<string>();
    for (const sub of group.subs) {
      if (inGroup.has(sub.name)) throw new Error(`[defineGroup] duplicate name "${sub.name}" in ${def.name} ${group.name}`);
      inGroup.add(sub.name);
      g.addSubcommand(buildSub(sub, `${def.name} ${group.name} ${sub.name}`));
      runMap.set(`${group.name}/${sub.name}`, guarded(sub));
      if (sub.autocomplete) autoMap.set(`${group.name}/${sub.name}`, sub.autocomplete);
    }
    data.addSubcommandGroup(g);
  }

  const keyOf = (i: ChatInputCommandInteraction | AutocompleteInteraction) =>
    `${i.options.getSubcommandGroup(false) ?? ''}/${i.options.getSubcommand(true)}`;

  return {
    data,
    async run(interaction) {
      const fn = runMap.get(keyOf(interaction));
      if (!fn) return interaction.reply({ content: 'That subcommand is not available.', ephemeral: true });
      return fn(interaction);
    },
    async autocomplete(interaction) {
      const fn = autoMap.get(keyOf(interaction));
      if (fn) return fn(interaction);
      return interaction.respond([]);
    },
  };
}

// ─── Adapter: existing single Command → Sub ─────────────────────────────────

interface JsonOption {
  type: number;
  name: string;
  description: string;
  required?: boolean;
  min_value?: number;
  max_value?: number;
  min_length?: number;
  max_length?: number;
  choices?: { name: string; value: string | number }[];
  channel_types?: number[];
  autocomplete?: boolean;
  options?: JsonOption[];
}

/**
 * Re-declare a command's options on a subcommand builder from its JSON form, so an
 * existing top-level command file can be mounted under a group without rewriting
 * its option list.
 */
function applyJsonOptions(sub: SlashCommandSubcommandBuilder, opts: JsonOption[]) {
  for (const o of opts) {
    const base = <T extends { setName(n: string): T; setDescription(d: string): T; setRequired(r: boolean): T }>(b: T) =>
      b.setName(o.name).setDescription(o.description).setRequired(!!o.required);
    switch (o.type) {
      case 3:
        sub.addStringOption(b => {
          base(b);
          if (o.min_length !== undefined) b.setMinLength(o.min_length);
          if (o.max_length !== undefined) b.setMaxLength(o.max_length);
          if (o.autocomplete) b.setAutocomplete(true);
          else if (o.choices?.length) b.addChoices(...(o.choices as { name: string; value: string }[]));
          return b;
        });
        break;
      case 4:
        sub.addIntegerOption(b => {
          base(b);
          if (o.min_value !== undefined) b.setMinValue(o.min_value);
          if (o.max_value !== undefined) b.setMaxValue(o.max_value);
          if (o.autocomplete) b.setAutocomplete(true);
          else if (o.choices?.length) b.addChoices(...(o.choices as { name: string; value: number }[]));
          return b;
        });
        break;
      case 10:
        sub.addNumberOption(b => {
          base(b);
          if (o.min_value !== undefined) b.setMinValue(o.min_value);
          if (o.max_value !== undefined) b.setMaxValue(o.max_value);
          if (o.autocomplete) b.setAutocomplete(true);
          else if (o.choices?.length) b.addChoices(...(o.choices as { name: string; value: number }[]));
          return b;
        });
        break;
      case 5: sub.addBooleanOption(b => base(b)); break;
      case 6: sub.addUserOption(b => base(b)); break;
      case 7:
        sub.addChannelOption(b => {
          base(b);
          if (o.channel_types?.length) b.addChannelTypes(...(o.channel_types as never[]));
          return b;
        });
        break;
      case 8: sub.addRoleOption(b => base(b)); break;
      case 9: sub.addMentionableOption(b => base(b)); break;
      case 11: sub.addAttachmentOption(b => base(b)); break;
      default:
        throw new Error(`[fromCommand] unsupported option type ${o.type} on ${o.name}`);
    }
  }
}

/**
 * Mount an existing top-level Command that itself has subcommands (e.g. `/shop browse|buy`)
 * as a subcommand group. Its run() keeps working unchanged because
 * interaction.options.getSubcommand() still returns the leaf name inside a group.
 */
export function groupFromCommand(cmd: Command, name?: string): SubGroup {
  const json = cmd.data.toJSON() as CmdJson;
  const subs = (json.options ?? []).filter(o => o.type === 1);
  if (subs.length === 0 || !cmd.run) throw new Error(`[groupFromCommand] ${json.name} has no subcommands or no run()`);
  if ((json.options ?? []).some(o => o.type === 2)) throw new Error(`[groupFromCommand] ${json.name} has nested groups; use foldCommand()`);
  const run = cmd.run;
  const meta = metaOf(json);
  return {
    name: name ?? json.name,
    description: json.description,
    subs: subs.map(s => ({
      name: s.name,
      description: s.description,
      options: b => applyJsonOptions(b as SlashCommandSubcommandBuilder, s.options ?? []),
      run,
      autocomplete: cmd.autocomplete,
      ...meta,
    })),
  };
}

interface CmdJson { name: string; description: string; options?: JsonOption[]; default_member_permissions?: string | null; contexts?: number[] }

/** Permission / guild-only requirements of a command, expressed the way Sub carries them. */
function metaOf(json: CmdJson): Pick<Sub, 'permissions' | 'guildOnly'> {
  const perms = json.default_member_permissions ? BigInt(json.default_member_permissions) : undefined;
  const guildOnly = !!json.contexts?.length && json.contexts.every(c => c === 0);
  return { ...(perms ? { permissions: perms } : {}), ...(guildOnly ? { guildOnly: true } : {}) };
}

type Leaf = { group: string | null; sub: string };

/**
 * Presents `i` as if the command had been invoked under its ORIGINAL subcommand/group names.
 * A folded command's handler keeps calling getSubcommand()/getSubcommandGroup(), which would otherwise report the parent's names.
 */
export function spoofLeaf<T extends ChatInputCommandInteraction | AutocompleteInteraction>(i: T, leaf: Leaf): T {
  const bindGet = (target: object, prop: string | symbol) => { const v = Reflect.get(target, prop, target); return typeof v === 'function' ? v.bind(target) : v; };
  const opts = new Proxy(i.options as object, {
    get(target, prop) {
      if (prop === 'getSubcommand') return () => leaf.sub;
      if (prop === 'getSubcommandGroup') return () => leaf.group;
      return bindGet(target, prop);
    },
  });
  return new Proxy(i as object, { get(target, prop) { return prop === 'options' ? opts : bindGet(target, prop); } }) as T;
}

/**
 * Mount an existing command that has subcommands AND/OR nested groups as ONE subcommand group of a parent.
 * Discord only allows two levels (`/parent group sub`), so the source's own groups are flattened into `group-sub` names
 * (e.g. `/levelconfig roles add` → `/config levels roles-add`). Handlers still see their original names via spoofLeaf().
 */
export function foldCommand(cmd: Command, o: { name?: string; description?: string } = {}): SubGroup {
  const json = cmd.data.toJSON() as CmdJson;
  const run = cmd.run;
  if (!run) throw new Error(`[foldCommand] ${json.name} has no run()`);
  const meta = metaOf(json);
  const subs: Sub[] = [];
  const add = (s: JsonOption, group: string | null) => {
    const name = (group ? `${group}-${s.name}` : s.name).slice(0, 32);
    subs.push({
      name, description: s.description,
      options: b => applyJsonOptions(b as SlashCommandSubcommandBuilder, s.options ?? []),
      run: i => run(spoofLeaf(i, { group, sub: s.name })),
      autocomplete: cmd.autocomplete ? i => cmd.autocomplete!(spoofLeaf(i, { group, sub: s.name })) : undefined,
      ...meta,
    });
  };
  for (const opt of json.options ?? []) {
    if (opt.type === 1) add(opt, null);
    else if (opt.type === 2) for (const s of opt.options ?? []) add(s, opt.name);
  }
  if (!subs.length) throw new Error(`[foldCommand] ${json.name} has no subcommands; use fromCommand()`);
  return { name: o.name ?? json.name, description: o.description ?? json.description, subs };
}

/** Finds a sub by name in a list and (optionally) renames it — used to re-mount handler modules at a new command path. */
export function pickSub(subs: Sub[], name: string, rename?: string, patch: Partial<Sub> = {}): Sub {
  const s = subs.find(x => x.name === name);
  if (!s) throw new Error(`[pickSub] no subcommand "${name}" (have: ${subs.map(x => x.name).join(', ')})`);
  return { ...s, name: rename ?? s.name, ...patch };
}

/**
 * A top-level command with NO subcommands (`/math expression`), built from a Sub. Same scope rules as defineGroup:
 * 'anywhere' (default) = usable via user install, in any server, DMs and group DMs.
 */
export function defineLeaf(sub: Sub, o: { name?: string; scope?: Scope; permissions?: bigint } = {}): Command {
  const name = o.name ?? sub.name;
  assertName('command', name, name);
  assertDescription(sub.description, name);
  const data = new SlashCommandBuilder().setName(name).setDescription(sub.description);
  if ((o.scope ?? 'anywhere') === 'anywhere') {
    data.setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall]);
    data.setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);
  } else {
    data.setIntegrationTypes([ApplicationIntegrationType.GuildInstall]);
    data.setContexts([InteractionContextType.Guild]);
  }
  // A Sub's option callback only uses the add*Option methods, which SlashCommandBuilder shares with the subcommand builder.
  sub.options?.(data as unknown as SlashCommandSubcommandBuilder);
  const run = guarded({ ...sub, permissions: o.permissions ?? sub.permissions });
  return { data: data as never, run, autocomplete: sub.autocomplete };
}

/**
 * Mount an existing top-level Command as a subcommand. `name` renames it (default:
 * the command's own name). The command must not itself use subcommands.
 */
export function fromCommand(cmd: Command, name?: string): Sub {
  const json = cmd.data.toJSON() as CmdJson;
  const opts = json.options ?? [];
  if (opts.some(o => o.type === 1 || o.type === 2)) {
    throw new Error(`[fromCommand] ${json.name} already has subcommands; mount it as its own group instead`);
  }
  if (!cmd.run) throw new Error(`[fromCommand] ${json.name} has no run()`);
  return {
    name: name ?? json.name,
    description: json.description,
    options: b => applyJsonOptions(b as SlashCommandSubcommandBuilder, opts),
    run: cmd.run,
    autocomplete: cmd.autocomplete,
    ...metaOf(json),
  };
}
