import { describe, expect, test } from 'bun:test';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../src/interfaces/command';
import { defineGroup, foldCommand, fromCommand, groupFromCommand, spoofLeaf } from '../src/framework/group';

/** A legacy-style command with direct subs AND a nested group, like /levelconfig. */
function legacy(seen: { group: string | null; sub: string; opt?: string | null }[]): Command {
  const data = new SlashCommandBuilder().setName('legacy').setDescription('Legacy config')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('view').setDescription('View settings'))
    .addSubcommand(s => s.setName('set').setDescription('Set a value').addStringOption(o => o.setName('value').setDescription('The value').setRequired(true)))
    .addSubcommandGroup(g => g.setName('roles').setDescription('Role rewards')
      .addSubcommand(s => s.setName('add').setDescription('Add a reward').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
      .addSubcommand(s => s.setName('remove').setDescription('Remove a reward')));
  return {
    data: data as never,
    async run(i) { seen.push({ group: i.options.getSubcommandGroup(false), sub: i.options.getSubcommand(true), opt: i.options.getString('value') }); },
  };
}

function fakeParent(o: { group?: string | null; sub: string; guild?: boolean; perms?: bigint; string?: string }) {
  const replies: any[] = [];
  const i: any = {
    options: { getSubcommandGroup: () => o.group ?? null, getSubcommand: () => o.sub, getString: () => o.string ?? null },
    inGuild: () => o.guild ?? true,
    memberPermissions: { has: (p: bigint) => ((o.perms ?? 0n) & p) === p },
    reply: async (p: any) => { replies.push(p); },
    marker: 'original',
  };
  return { i, replies };
}

describe('spoofLeaf', () => {
  test('reports the original group/sub names but passes everything else through', async () => {
    const { i } = fakeParent({ group: 'parentgroup', sub: 'parent-sub', string: 'hello' });
    const s = spoofLeaf(i, { group: 'roles', sub: 'add' });
    expect(s.options.getSubcommandGroup()).toBe('roles'); expect(s.options.getSubcommand()).toBe('add'); expect(s.options.getString('x')).toBe('hello');
    expect((s as any).marker).toBe('original'); expect(i.options.getSubcommandGroup()).toBe('parentgroup'); // the real one is untouched
    const s2 = spoofLeaf(i, { group: null, sub: 'view' }); expect(s2.options.getSubcommandGroup()).toBeNull();
  });
});

describe('foldCommand', () => {
  test('flattens nested groups into group-sub names, keeps direct subs, and mirrors options', () => {
    const g = foldCommand(legacy([]), { name: 'levels', description: 'Level settings' });
    expect(g.name).toBe('levels'); expect(g.subs.map(s => s.name)).toEqual(['view', 'set', 'roles-add', 'roles-remove']);
    const parent = defineGroup({ name: 'config', description: 'c', groups: [g] });
    const json: any = parent.data.toJSON();
    const levels = json.options[0];
    expect(levels.type).toBe(2); expect(levels.options.map((o: any) => o.name)).toEqual(['view', 'set', 'roles-add', 'roles-remove']);
    expect(levels.options[1].options[0]).toMatchObject({ name: 'value', required: true }); expect(levels.options[2].options[0]).toMatchObject({ name: 'role', required: true });
  });

  test('the legacy handler still sees its ORIGINAL group and subcommand', async () => {
    const seen: any[] = [];
    const parent = defineGroup({ name: 'config', description: 'c', groups: [foldCommand(legacy(seen), { name: 'levels' })] });
    const perms = PermissionFlagsBits.ManageGuild;
    await parent.run!(fakeParent({ group: 'levels', sub: 'roles-add', perms, string: 'v1' }).i);
    await parent.run!(fakeParent({ group: 'levels', sub: 'view', perms }).i);
    await parent.run!(fakeParent({ group: 'levels', sub: 'set', perms, string: 'x' }).i);
    expect(seen).toEqual([{ group: 'roles', sub: 'add', opt: 'v1' }, { group: null, sub: 'view', opt: null }, { group: null, sub: 'set', opt: 'x' }]);
  });

  test('inherits the source command permission and enforces it at run time', async () => {
    const seen: any[] = [];
    const parent = defineGroup({ name: 'config', description: 'c', groups: [foldCommand(legacy(seen), { name: 'levels' })] });
    const denied = fakeParent({ group: 'levels', sub: 'view', perms: 0n });
    await parent.run!(denied.i);
    expect(seen).toEqual([]); expect(denied.replies[0].content).toMatch(/Manage Guild|Manage Server/i); expect(denied.replies[0].flags & 64).toBeTruthy();
    const ok = fakeParent({ group: 'levels', sub: 'view', perms: PermissionFlagsBits.ManageGuild });
    await parent.run!(ok.i); expect(seen).toHaveLength(1); expect(ok.replies).toEqual([]);
    const dm = fakeParent({ group: 'levels', sub: 'view', guild: false, perms: PermissionFlagsBits.ManageGuild });
    await parent.run!(dm.i); expect(seen).toHaveLength(1); expect(dm.replies[0].content).toMatch(/server/i);
  });

  test('autocomplete is spoofed too', async () => {
    let got: any = null;
    const cmd = legacy([]); cmd.autocomplete = async i => { got = { g: i.options.getSubcommandGroup(false), s: i.options.getSubcommand(true) }; };
    const parent = defineGroup({ name: 'p', description: 'p', groups: [foldCommand(cmd, { name: 'legacy' })] });
    await parent.autocomplete!({ options: { getSubcommandGroup: () => 'legacy', getSubcommand: () => 'roles-add' }, respond: async () => {} } as any);
    expect(got).toEqual({ g: 'roles', s: 'add' });
  });

  test('name length and rejects commands without subcommands', () => {
    const flat: Command = { data: new SlashCommandBuilder().setName('flat').setDescription('flat').addStringOption(o => o.setName('a').setDescription('a')) as never, run: async () => {} };
    expect(() => foldCommand(flat)).toThrow(/no subcommands/);
    const longNamed: Command = { data: new SlashCommandBuilder().setName('x').setDescription('x').addSubcommandGroup(g => g.setName('a'.repeat(20)).setDescription('g').addSubcommand(s => s.setName('b'.repeat(20)).setDescription('s'))) as never, run: async () => {} };
    expect(foldCommand(longNamed).subs[0]!.name.length).toBeLessThanOrEqual(32);
  });
});

describe('fromCommand / groupFromCommand carry permissions and guild-only', () => {
  test('a guild-only, permissioned flat command keeps both requirements when mounted', async () => {
    const seen: string[] = [];
    const cmd: Command = {
      data: new SlashCommandBuilder().setName('ban').setDescription('Ban').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers).setContexts([0]).addUserOption(o => o.setName('user').setDescription('who').setRequired(true)) as never,
      run: async () => { seen.push('ran'); },
    };
    const parent = defineGroup({ name: 'mod', description: 'm', subs: [fromCommand(cmd)] });
    await parent.run!(fakeParent({ sub: 'ban', perms: 0n }).i); expect(seen).toEqual([]);
    await parent.run!(fakeParent({ sub: 'ban', perms: PermissionFlagsBits.BanMembers }).i); expect(seen).toEqual(['ran']);
    await parent.run!(fakeParent({ sub: 'ban', perms: PermissionFlagsBits.BanMembers, guild: false }).i); expect(seen).toEqual(['ran']);
  });
  test('an unrestricted command stays unrestricted', async () => {
    const seen: string[] = [];
    const cmd: Command = { data: new SlashCommandBuilder().setName('ping').setDescription('Ping').setContexts([0, 1]) as never, run: async () => { seen.push('pong'); } };
    const parent = defineGroup({ name: 'x', description: 'x', subs: [fromCommand(cmd)] });
    await parent.run!(fakeParent({ sub: 'ping', perms: 0n, guild: false }).i); expect(seen).toEqual(['pong']);
  });
  test('groupFromCommand refuses nested groups (they need foldCommand)', () => {
    expect(() => groupFromCommand(legacy([]))).toThrow(/foldCommand/);
  });
});
