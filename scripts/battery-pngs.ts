/**
 * Writes the battery icons as PNG files: one per percent (battery-000.png … battery-100.png), cut from
 * src/assets/images/juul/battery.png the same way the bot cuts the emojis it uploads.
 *   bun scripts/battery-pngs.ts [outDir]     (default: ./data/battery-levels)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BATTERY_LEVELS, batteryLevel } from '../src/fun/juulEmoji';

const art = path.resolve(import.meta.dir, '../src/assets/images/juul/battery.png');
const out = path.resolve(Bun.argv[2] ?? path.join(import.meta.dir, '../data/battery-levels'));
mkdirSync(out, { recursive: true });
const full = readFileSync(art);
for (let p = 0; p <= BATTERY_LEVELS; p++) {
  writeFileSync(path.join(out, `battery-${String(p).padStart(3, '0')}.png`), p === BATTERY_LEVELS ? full : await batteryLevel(full, p));
}
console.log(`wrote ${BATTERY_LEVELS + 1} icons (0–${BATTERY_LEVELS}%) to ${out}`);
