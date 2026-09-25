// Runs before every test file. Tests must be hermetic: Bun auto-loads a developer's real .env (bot token, API keys…), so
// first REMOVE every variable that file defines, then provide harmless dummies. No test can then reach real services,
// real data, or even see a real credential.
import { readFileSync } from 'node:fs';
import path from 'node:path';

try {
  const dotenv = readFileSync(path.resolve(import.meta.dir, '../.env'), 'utf8');
  for (const line of dotenv.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m) delete Bun.env[m[1]!];
  }
} catch { /* no .env: nothing to scrub */ }

Bun.env.DB_PATH = ':memory:';
Bun.env.TOKEN = 'test-token';
Bun.env.CLIENT_ID = '1';
Bun.env.GUILD_ID = '1';
Bun.env.NODE_ENV = 'test';
