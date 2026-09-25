import { describe, expect, test } from 'bun:test';
import { findVoice, searchVoices } from '../src/services/tts';
import { MELODIES } from '../src/services/singlite';

describe('the named singing and character voices', () => {
  const want: [string, string, 'sing' | 'char'][] = [
    ['Tenor', 'sing:tenor', 'sing'], ['Alto', 'sing:alto', 'sing'], ['Sunshine Soon', 'sing:sunshine', 'sing'], ['Warmy Breeze', 'sing:breeze', 'sing'], ['Glorious', 'sing:glorious', 'sing'],
    ['Rocket', 'char:rascal', 'char'], ['Stormtrooper', 'char:trooper', 'char'], ['Ghostface', 'char:masked', 'char'],
  ];
  test('each one can be picked by its name (any capitalisation) and is generated locally', () => {
    for (const [name, id, engine] of want) {
      expect(findVoice(name)?.id, name).toBe(id); expect(findVoice(name.toUpperCase())?.id, name).toBe(id); expect(findVoice(name)?.engine).toBe(engine);
    }
  });
  test('every singing voice has a melody, and each new name shows up in search', () => {
    for (const [, id, engine] of want) if (engine === 'sing') expect(MELODIES.some(m => `sing:${m.id}` === id), id).toBe(true);
    expect(searchVoices('alto').some(v => v.id === 'sing:alto')).toBe(true); expect(searchVoices('ghostface').some(v => v.id === 'char:masked')).toBe(true);
  });
});
