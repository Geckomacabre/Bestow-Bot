/** Parses "90s", "10m", "2h30m", "1d", "1w2d", "1 hour 5 minutes" → milliseconds. Returns null for anything that isn't a duration. */
const UNITS: Record<string, number> = {
  s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000, m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000,
  h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000, d: 86_400_000, day: 86_400_000, days: 86_400_000,
  w: 604_800_000, wk: 604_800_000, week: 604_800_000, weeks: 604_800_000,
};
const PAIR = /(\d+(?:\.\d+)?)\s*([a-z]+)/g;

export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s || s.length > 60) return null;
  let total = 0, found = 0;
  for (const m of s.matchAll(PAIR)) {
    const unit = UNITS[m[2]!];
    if (!unit) return null;
    total += Number(m[1]) * unit;
    found++;
  }
  // Nothing may be left once the "<number><unit>" pairs and separators (spaces, commas, "and") are removed.
  const leftover = s.replace(PAIR, '').replace(/[\s,]|\band\b/g, '');
  if (!found || leftover) return null;
  return Number.isFinite(total) && total > 0 ? Math.round(total) : null;
}

/** 90_000 → "1m 30s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return '0s';
  const parts: string[] = [];
  let s = Math.floor(ms / 1000);
  for (const [n, label] of [[86_400, 'd'], [3600, 'h'], [60, 'm'], [1, 's']] as const) { const q = Math.floor(s / n); if (q) { parts.push(`${q}${label}`); s -= q * n; } }
  return parts.slice(0, 3).join(' ');
}
