import { SQL } from 'bun';
const db = new SQL('sqlite://data/db.sqlite');
const tables = [
  'config', 'log_config', 'economy_config', 'xp_config',
  'welcome_config', 'starboard_config', 'birthday_config',
];
for (const t of tables) {
  const rows = await db.unsafe(`SELECT COUNT(*) as n FROM ${t}`);
  console.log(`${t}: ${rows[0].n} row(s)`);
}
process.exit(0);
