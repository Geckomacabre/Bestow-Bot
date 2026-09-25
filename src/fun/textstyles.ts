/** Text toys for /say: 𝓯𝓻𝓮𝓪𝓴𝔂 script letters, uwu-speak and reversal. Pure, so they're unit-tested. */

// Mathematical Bold Script: A–Z start at U+1D4D0, a–z at U+1D4EA (no gaps in the bold block).
const SCRIPT_UPPER = 0x1d4d0;
const SCRIPT_LOWER = 0x1d4ea;

export function freaky(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 65 && c <= 90) out += String.fromCodePoint(SCRIPT_UPPER + c - 65);
    else if (c >= 97 && c <= 122) out += String.fromCodePoint(SCRIPT_LOWER + c - 97);
    else out += ch;
  }
  return out;
}

const FACES = [' uwu', ' owo', ' >w<', ' ^w^', ' (・`ω´・)', ' :3', ' x3', ' ✨'];

/** Deterministic for a given input (the "random" choices come from the text itself), so tests are stable. */
export function uwu(text: string): string {
  let seed = 0;
  for (const ch of text) seed = (seed * 31 + ch.codePointAt(0)!) >>> 0;
  const next = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 0x100000000; };
  // Keep links, mentions and custom emoji intact.
  return text.split(/(\s+)/).map(word => {
    if (!word.trim() || /^(https?:\/\/|<[@#:a]|@)/i.test(word)) return word;
    let w = word
      .replace(/[rl]/g, 'w').replace(/[RL]/g, 'W')
      .replace(/n([aeiou])/g, 'ny$1').replace(/N([aeiou])/g, 'Ny$1').replace(/N([AEIOU])/g, 'NY$1')
      .replace(/ove/g, 'uv');
    if (/^[a-z]/i.test(w) && w.length > 2 && next() < 0.12) w = `${w[0]}-${w}`; // st-stutter
    if (/[.!?]$/.test(w) && next() < 0.6) w += FACES[Math.floor(next() * FACES.length)];
    return w;
  }).join('');
}

/** Reverses by code point so emoji and non-Latin letters survive. */
export const reverse = (text: string): string => [...text].reverse().join('');
