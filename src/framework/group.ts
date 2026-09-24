import {
  ApplicationIntegrationType,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  InteractionContextType,
  PermissionsBitField,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  SlashCommandSubcommandGroupBuilder,
} from 'discord.js';
import type { Command } from '../interfaces/command';

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
  assertDescription(sub.description, path);
  const b = new SlashCommandSubcommandBuilder().setName(sub.name).setDescription(sub.description);
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
    runMap.set(`/${sub.name}`, sub.run);
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
      runMap.set(`${group.name}/${sub.name}`, sub.run);
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
 * Mount an existing top-level Command as a subcommand. `name` renames it (default:
 * the command's own name). The command must not itself use subcommands.
 */
export function fromCommand(cmd: Command, name?: string): Sub {
  const json = cmd.data.toJSON() as { name: string; description: string; options?: JsonOption[] };
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
  };
}
