// Runs before every test file: point the bot at a throw-away in-memory database and
// provide the env vars config.ts insists on, so no test can touch real data.
Bun.env.DB_PATH = ':memory:';
Bun.env.TOKEN ??= 'test-token';
Bun.env.CLIENT_ID ??= '1';
Bun.env.GUILD_ID ??= '1';
Bun.env.NODE_ENV = 'test';
