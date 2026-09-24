import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeZip } from '../src/framework/zip';

describe('makeZip', () => {
  test('produces a structurally valid archive (signatures, counts, sizes)', () => {
    const z = makeZip([{ name: 'a.txt', data: Buffer.from('hello') }, { name: 'dir/b.bin', data: Buffer.from([1, 2, 3, 4]) }]);
    expect(z.readUInt32LE(0)).toBe(0x04034b50);
    const eocd = z.length - 22;
    expect(z.readUInt32LE(eocd)).toBe(0x06054b50);
    expect(z.readUInt16LE(eocd + 8)).toBe(2);   // entries on disk
    expect(z.readUInt16LE(eocd + 10)).toBe(2);  // total entries
    const centralOffset = z.readUInt32LE(eocd + 16);
    expect(z.readUInt32LE(centralOffset)).toBe(0x02014b50);
  });

  test('is readable by a real unzip tool and round-trips content', async () => {
    // GNU tar (e.g. Git for Windows) can't read zips, so pick bsdtar on Windows and unzip elsewhere.
    const win = process.platform === 'win32';
    const bin = win ? 'C:\\Windows\\System32\\tar.exe' : Bun.which('unzip');
    if (!bin || (win && !(await Bun.file(bin).exists()))) return;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'onyx-zip-'));
    const payload = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 7) % 251));
    await writeFile(path.join(dir, 'x.zip'), makeZip([{ name: 'one.txt', data: Buffer.from('first file\n') }, { name: 'frames/two.bin', data: payload }]));
    const ex = Bun.spawnSync(win ? [bin, '-xf', 'x.zip'] : [bin, '-o', 'x.zip'], { cwd: dir });
    expect(ex.exitCode).toBe(0);
    expect(await readFile(path.join(dir, 'one.txt'), 'utf8')).toBe('first file\n');
    expect(Buffer.compare(await readFile(path.join(dir, 'frames', 'two.bin')), payload)).toBe(0);
  });

  test('empty archive is valid', () => {
    const z = makeZip([]);
    expect(z.length).toBe(22);
    expect(z.readUInt32LE(0)).toBe(0x06054b50);
  });
});
