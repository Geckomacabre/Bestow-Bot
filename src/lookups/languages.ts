/** Language names ↔ Google Translate codes, for /translate's free-text `to` / `from_lang` ("English", "fr", "ro", "chinese"…). */

export const LANGUAGE_CODES = [
  'af', 'sq', 'am', 'ar', 'hy', 'az', 'eu', 'be', 'bn', 'bs', 'bg', 'ca', 'ceb', 'zh-CN', 'zh-TW', 'co', 'hr', 'cs', 'da', 'nl', 'en', 'eo', 'et', 'fi', 'fr', 'fy', 'gl', 'ka', 'de',
  'el', 'gu', 'ht', 'ha', 'haw', 'he', 'hi', 'hmn', 'hu', 'is', 'ig', 'id', 'ga', 'it', 'ja', 'jv', 'kn', 'kk', 'km', 'rw', 'ko', 'ku', 'ky', 'lo', 'la', 'lv', 'lt', 'lb', 'mk', 'mg',
  'ms', 'ml', 'mt', 'mi', 'mr', 'mn', 'my', 'ne', 'no', 'ny', 'or', 'ps', 'fa', 'pl', 'pt', 'pa', 'ro', 'ru', 'sm', 'gd', 'sr', 'st', 'sn', 'sd', 'si', 'sk', 'sl', 'so', 'es', 'su',
  'sw', 'sv', 'tl', 'tg', 'ta', 'tt', 'te', 'th', 'tr', 'tk', 'uk', 'ur', 'ug', 'uz', 'vi', 'cy', 'xh', 'yi', 'yo', 'zu',
] as const;

const names = new Intl.DisplayNames(['en'], { type: 'language' });
export const languageName = (code: string) => { try { return names.of(code) ?? code; } catch { return code; } };

const ALIASES: Record<string, string> = { chinese: 'zh-CN', mandarin: 'zh-CN', 'simplified chinese': 'zh-CN', 'traditional chinese': 'zh-TW', filipino: 'tl', tagalog: 'tl', hebrew: 'he', persian: 'fa', farsi: 'fa', norwegian: 'no', 'brazilian portuguese': 'pt' };

/** "English" / "en" / "EN" / "chinese" → a code; null if unknown. */
export function resolveLanguage(input: string): string | null {
  const q = input.trim().toLowerCase();
  if (!q) return null;
  if (q === 'auto') return 'auto';
  const code = LANGUAGE_CODES.find(c => c.toLowerCase() === q);
  if (code) return code;
  if (ALIASES[q]) return ALIASES[q]!;
  return LANGUAGE_CODES.find(c => languageName(c).toLowerCase() === q)
    ?? LANGUAGE_CODES.find(c => languageName(c).toLowerCase().startsWith(q) && q.length >= 3) ?? null;
}

export function searchLanguages(q: string): { name: string; value: string }[] {
  const s = q.trim().toLowerCase();
  return LANGUAGE_CODES.map(c => ({ name: `${languageName(c)} (${c})`, value: c }))
    .filter(x => !s || x.name.toLowerCase().includes(s))
    .sort((a, b) => a.name.localeCompare(b.name));
}
