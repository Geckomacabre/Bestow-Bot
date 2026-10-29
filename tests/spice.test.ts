import { afterEach, describe, expect, test } from 'bun:test';
import { resetSpice, SPICE, spice, spiceIcons, syncSpiceEmojis, useSpice } from '../src/utils/spice';
import { cv2Err, cv2Text } from '../src/utils/components';
import { card } from '../src/lookups/card';

function fakeClient(existing: { id: string; name: string }[] = []) {
  const created: { name: string }[] = [], deleted: string[] = [];
  const have = new Map(existing.map(e => [e.id, { ...e, delete: async () => { deleted.push(e.id); } }]));
  const client = { application: { emojis: { fetch: async () => have, create: async (o: { name: string }) => { created.push(o); return { id: String(1000 + created.length - 1), name: o.name }; } } } };
  return { client: client as never, created, deleted };
}
const tags = () => new Map([['yes.gif', '<a:spice_yes_aaaaaa:1>'], ['no.png', '<:spice_no_bbbbbb:2>'], ['warn.gif', '<a:spice_warn_cccccc:3>']]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const textOf = (msg: any) => JSON.stringify(msg.components.map((c: any) => c.toJSON()));

afterEach(() => resetSpice());

describe('spice', () => {
  test('leaves text alone until the emojis are synced', () => {
    expect(spice('✅ Done')).toBe('✅ Done');
  });
  test('swaps plain emoji for the synced ones, both spellings of ⚠️, but not inside code', () => {
    useSpice(tags());
    expect(spice('✅ Saved ❌ nope')).toBe('<a:spice_yes_aaaaaa:1> Saved <:spice_no_bbbbbb:2> nope');
    expect(spice('⚠️ careful ⚠ again')).toBe('<a:spice_warn_cccccc:3> careful <a:spice_warn_cccccc:3> again');
    expect(spice('run `✅` or\n```\n❌\n```\n✅')).toBe('run `✅` or\n```\n❌\n```\n<a:spice_yes_aaaaaa:1>');
    expect(spice('🎉 not synced')).toBe('🎉 not synced');
  });
  test('stays plain when swapping would pass the length limit', () => {
    useSpice(tags());
    const many = '✅'.repeat(200);
    expect(spice(many)).toBe(many);
    expect(spice('✅', 10)).toBe('✅');
  });
  test('reaches replies built by cv2Text, cv2Err and card', () => {
    useSpice(tags());
    expect(textOf(cv2Text('✅ Saved'))).toContain('<a:spice_yes_aaaaaa:1> Saved');
    expect(textOf(cv2Err('❌ No'))).toContain('<:spice_no_bbbbbb:2> No');
    expect(textOf(card({ title: '✅ Done', fields: [['⚠️ Note', 'x']] }))).toContain('<a:spice_yes_aaaaaa:1> Done');
  });
});

describe('spice art', () => {
  test('every emoji in SPICE has art, small enough for Discord, with a valid emoji name', async () => {
    const icons = await spiceIcons();
    expect(icons.map(i => i.file).sort()).toEqual([...new Set(Object.values(SPICE))].sort());
    for (const i of icons) {
      expect(i.name).toMatch(/^spice_[a-z]+_[0-9a-f]{6}$/); expect(i.name.length).toBeLessThanOrEqual(32);
      expect(i.data.length).toBeLessThan(256 * 1024);
      expect(i.animated).toBe(i.file.endsWith('.gif'));
    }
  });
  test('sync uploads what is missing, reuses what is there, removes replaced art and leaves other emojis alone', async () => {
    const icons = await spiceIcons();
    const { client, created, deleted } = fakeClient([{ id: '55', name: icons[0]!.name }, { id: '56', name: 'spice_yes_000000' }, { id: '57', name: 'cash_abcdef' }]);
    await syncSpiceEmojis(client);
    expect(created).toHaveLength(icons.length - 1); expect(deleted).toEqual(['56']);
    const first = Object.entries(SPICE).find(([, f]) => f === icons[0]!.file)![0];
    expect(spice(first)).toBe(`<${icons[0]!.animated ? 'a' : ''}:${icons[0]!.name}:55>`);
    expect(spice('✅')).toMatch(/^<a:spice_yes_[0-9a-f]{6}:\d+>$/);
  });
});
