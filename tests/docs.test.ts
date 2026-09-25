import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { buildCommandsDoc } from '../scripts/gen-commands-doc';

const root = path.resolve(import.meta.dir, '..');

describe('documentation stays true', () => {
  test('COMMANDS.md matches the live command registry (run `bun run docs` after changing commands)', async () => {
    const onDisk = readFileSync(path.join(root, 'COMMANDS.md'), 'utf8').replace(/\r\n/g, '\n');
    expect(onDisk).toBe(await buildCommandsDoc());
  });

  test('every environment variable the code reads is documented in .env.example', () => {
    const example = readFileSync(path.join(root, '.env.example'), 'utf8');
    const used = new Set<string>();
    const walk = (dir: string) => { for (const f of readdirSync(dir)) { const p = path.join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) for (const m of readFileSync(p, 'utf8').matchAll(/Bun\.env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1]!); } };
    walk(path.join(root, 'src'));
    // Test-only switches and values set by the platform are intentionally undocumented.
    const internal = new Set(['ALLOW_PRIVATE_URLS', 'NODE_ENV', 'ROBLOX_DEVEX_RATE', 'SING_MAX_SECONDS', 'SING_POLL_MS', 'SING_TIMEOUT_MS']);
    const missing = [...used].filter(v => !internal.has(v) && !new RegExp(`^#?\\s*${v}=`, 'm').test(example));
    expect(missing, `Add to .env.example: ${missing.join(', ')}`).toEqual([]);
  });

  test('.env.example contains no real-looking secrets', () => {
    const example = readFileSync(path.join(root, '.env.example'), 'utf8');
    for (const line of example.split('\n')) {
      const m = /^#?\s*([A-Z_]+)=(.+)$/.exec(line);
      if (m && /TOKEN|KEY|SECRET/.test(m[1]!)) expect(m[2]!.trim(), line).toMatch(/^$|^#/);
    }
    expect(example).not.toMatch(/[MN][A-Za-z\d_-]{23,25}\.[\w-]{6}\.[\w-]{27,}/); // Discord bot-token shape
  });

  test('no secrets or personal paths are committed anywhere in the repo files we ship', () => {
    const bad = [/[MN][A-Za-z\d_-]{23,25}\.[\w-]{6}\.[\w-]{27,}/, /sk-[A-Za-z0-9]{32,}/, /gsk_[A-Za-z0-9]{40,}/, /xai-[A-Za-z0-9]{40,}/, /C:\\Users\\gecko/i];
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        if (['node_modules', '.git', 'data', 'assets', 'natives'].includes(f)) continue;
        const p = path.join(dir, f); const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else if (/\.(ts|md|json|yaml|yml|toml|example)$/.test(f) && st.size < 2_000_000 && !p.endsWith('docs.test.ts') && !p.endsWith('bun.lock')) { const t = readFileSync(p, 'utf8'); for (const re of bad) if (re.test(t)) hits.push(`${path.relative(root, p)} matches ${re}`); }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
