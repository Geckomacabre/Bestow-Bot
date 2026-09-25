import { getJson, HttpError } from '../framework/http.js';
import { LookupError } from './handler.js';

/**
 * /define: Merriam-Webster's Collegiate API when MW_DICTIONARY_KEY is set (free key at dictionaryapi.com), else the keyless
 * dictionaryapi.dev. Both are normalised to the same shape.
 */

export interface Definition { word: string; phonetic?: string; senses: { pos: string; defs: string[]; example?: string }[]; synonyms: string[]; source: string }

interface DevEntry { word: string; phonetic?: string; meanings: { partOfSpeech: string; definitions: { definition: string; example?: string; synonyms?: string[] }[]; synonyms?: string[] }[] }
interface MwEntry { meta?: { id?: string; stems?: string[] }; hwi?: { hw?: string; prs?: { mw?: string }[] }; fl?: string; shortdef?: string[] }

export function parseDev(raw: DevEntry[]): Definition | null {
  const e = raw[0];
  if (!e?.meanings?.length) return null;
  return {
    word: e.word, phonetic: e.phonetic, source: 'Free Dictionary',
    senses: e.meanings.slice(0, 3).map(m => ({ pos: m.partOfSpeech, defs: m.definitions.slice(0, 2).map(d => d.definition), example: m.definitions.find(d => d.example)?.example })),
    synonyms: [...new Set(e.meanings.flatMap(m => [...(m.synonyms ?? []), ...m.definitions.flatMap(d => d.synonyms ?? [])]))].slice(0, 8),
  };
}

/** MW returns plain strings (spelling suggestions) instead of entries when the word isn't found. */
export function parseMw(raw: (MwEntry | string)[], asked: string): Definition | null {
  const entries = raw.filter((x): x is MwEntry => typeof x === 'object' && !!x?.shortdef?.length);
  if (!entries.length) return null;
  const head = entries[0]!;
  const word = (head.hwi?.hw ?? head.meta?.id ?? asked).replace(/\*/g, '').replace(/:\d+$/, '');
  return {
    word, phonetic: head.hwi?.prs?.[0]?.mw ? `\\${head.hwi.prs[0].mw}\\` : undefined, source: 'Merriam-Webster',
    senses: entries.slice(0, 3).map(e => ({ pos: e.fl ?? '', defs: (e.shortdef ?? []).slice(0, 2) })),
    synonyms: [],
  };
}

export async function define(word: string): Promise<Definition> {
  const w = word.trim().toLowerCase();
  if (!w || w.length > 60) throw new LookupError('Give me a word (up to 60 characters).');
  const key = Bun.env.MW_DICTIONARY_KEY;
  if (key) {
    const raw = await getJson<(MwEntry | string)[]>(`https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(w)}?key=${encodeURIComponent(key)}`, { cacheMs: 60 * 60_000 });
    const d = parseMw(raw, w);
    if (d) return d;
    const suggestions = raw.filter((x): x is string => typeof x === 'string').slice(0, 5);
    throw new LookupError(`No definition found for **${w}**.${suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : ''}`);
  }
  try {
    const d = parseDev(await getJson<DevEntry[]>(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`, { cacheMs: 60 * 60_000 }));
    if (d) return d;
  } catch (e) {
    if (!(e instanceof HttpError && e.status === 404)) throw e;
  }
  throw new LookupError(`No definition found for **${w}**.`);
}
