import { describe, expect, test } from 'bun:test';
import { MathError, evaluate, formatNumber } from '../src/lookups/mathx';
import { ColorError, contrast, gradient, hslToRgb, luminance, palette, parseColor, readableOn, rgbToCmyk, rgbToHsl, toDecimal, toHex } from '../src/lookups/color';
import { ASCII_FONTS, asciify, compatibility, dailyRating, heartBar, markov, pickChain, shipName } from '../src/lookups/textfun';

describe('math evaluator', () => {
  const cases: [string, number][] = [
    ['1+2*3', 7], ['(1+2)*3', 9], ['2^3^2', 512], ['-2^2', -4], ['2^-1', 0.5], ['10/4', 2.5], ['10%3', 1], ['2(3+4)', 14], ['(1+2)(3+4)', 21], ['2pi', 2 * Math.PI],
    ['sqrt(16)+abs(-3)', 7], ['5!', 120], ['3!+2!', 8], ['max(1,9,3)', 9], ['min(4,2)', 2], ['log(1000)', 3], ['log(8,2)', 3], ['ln(e)', 1], ['round(3.14159,2)', 3.14], ['floor(-1.5)', -2],
    ['hypot(3,4)', 5], ['gcd(12,18)', 6], ['lcm(4,6)', 12], ['1e3+1', 1001], ['.5+.5', 1], ['100*(1+0.05)^2', 110.25], ['avg(2,4,6)', 4], ['deg(pi)', 180], ['sin(rad(90))', 1], ['2×3÷6', 1], ['--5', 5], ['+3', 3],
  ];
  for (const [expr, want] of cases) test(`${expr} = ${want}`, () => expect(evaluate(expr)).toBeCloseTo(want, 9));

  test('errors are friendly and specific', () => {
    const bad: [string, RegExp][] = [['1/0', /zero/i], ['sqrt(', /parenthesis|too early/i], ['(1+2', /parenthesis/i], ['foo(2)', /function/i], ['bar', /know/i], ['2 $ 3', /understand/i],
      ['', /Type an expression/], ['1 2 )', /extra|doesn't/i], ['sqrt(1,2)', /argument/], ['(-1)!', /whole number/], ['171!', /too large/], ['0/0', /zero/i], ['sqrt(-1)', /no real/]];
    for (const [e, re] of bad) expect(() => evaluate(e), e).toThrow(re);
    expect(() => evaluate('1+'.repeat(150) + '1')).toThrow(/under 200/);
  });

  test('it is not eval: code, property access and globals are just unknown symbols', () => {
    for (const e of ['process.exit()', 'constructor', 'globalThis', '__proto__', 'require("fs")', 'this', 'Math.PI', 'alert(1)', '`1`', 'a=1']) expect(() => evaluate(e), e).toThrow(MathError);
  });

  test('deep nesting is bounded', () => { expect(() => evaluate('('.repeat(60) + '1' + ')'.repeat(60))).toThrow(/nested/); });

  test('formatting avoids float noise and switches to exponents', () => {
    expect(formatNumber(evaluate('0.1+0.2'))).toBe('0.3');
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(1 / 3)).toBe('0.333333333333');
    expect(formatNumber(1e20)).toMatch(/e\+?20/);
    expect(formatNumber(evaluate('2^100'))).toMatch(/e/);
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(-Infinity)).toBe('−∞');
  });
});

describe('colors', () => {
  test('parses every supported notation to the same colour', () => {
    const want = { r: 255, g: 107, b: 107 };
    for (const s of ['#ff6b6b', 'ff6b6b', '#FF6B6B', 'rgb(255,107,107)', 'rgb(255 107 107)', 'RGB( 255 , 107 , 107 )', 'rgba(255,107,107,0.5)', '16739179']) expect(parseColor(s), s).toEqual(want);
    expect(parseColor('#f00')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColor('coral')).toEqual({ r: 255, g: 127, b: 80 });
    expect(parseColor('Sky Blue')).toEqual({ r: 135, g: 206, b: 235 });
    expect(parseColor('hsl(0, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0 });
    for (const bad of ['', 'notacolor', '#12345', 'rgb(300,0,0)', '#gggggg', 'hsl(x)']) expect(() => parseColor(bad), bad).toThrow(ColorError);
  });
  test('conversions round-trip', () => {
    for (const c of [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, { r: 255, g: 107, b: 107 }, { r: 18, g: 200, b: 94 }, { r: 128, g: 128, b: 128 }]) {
      const back = hslToRgb(rgbToHsl(c));
      expect(Math.abs(back.r - c.r) + Math.abs(back.g - c.g) + Math.abs(back.b - c.b)).toBeLessThanOrEqual(6);
      expect(parseColor(toHex(c))).toEqual(c);
      expect(parseColor(String(toDecimal(c)))).toEqual(c);
    }
    expect(rgbToHsl({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, l: 50 });
    expect(rgbToCmyk({ r: 0, g: 0, b: 0 })).toEqual({ c: 0, m: 0, y: 0, k: 100 });
    expect(rgbToCmyk({ r: 255, g: 0, b: 0 })).toEqual({ c: 0, m: 100, y: 100, k: 0 });
  });
  test('contrast follows WCAG', () => {
    expect(contrast({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 5);
    expect(contrast({ r: 255, g: 255, b: 255 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
    expect(luminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 6);
    expect(readableOn({ r: 255, g: 255, b: 0 })).toBe('black');
    expect(readableOn({ r: 0, g: 0, b: 128 })).toBe('white');
  });
  test('palettes and gradients', () => {
    const red = { r: 255, g: 0, b: 0 };
    expect(palette(red, 'complementary').map(toHex)).toEqual(['#ff0000', '#00ffff']);
    expect(palette(red, 'triadic').map(toHex)).toEqual(['#ff0000', '#00ff00', '#0000ff']);
    expect(palette(red, 'tetradic')).toHaveLength(4);
    expect(palette(red, 'monochrome')).toHaveLength(5);
    const g = gradient({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, 5);
    expect(g.map(toHex)).toEqual(['#000000', '#404040', '#808080', '#bfbfbf', '#ffffff']);
    expect(gradient(red, red, 1)).toHaveLength(2);   // clamped to at least 2
    expect(gradient(red, red, 99)).toHaveLength(30); // and at most 30
  });
});

describe('text toys', () => {
  test('markov output is made of words from the input and has the requested length', () => {
    const src = 'the quick brown fox jumps over the lazy dog while the quick red fox naps under the old oak tree near the lazy river';
    const words = new Set(src.split(' '));
    for (let i = 0; i < 20; i++) {
      const out = markov(src, 25).split(' ');
      expect(out).toHaveLength(25);
      for (const w of out) expect(words.has(w), w).toBe(true);
    }
    expect(() => markov('too short')).toThrow(/few words/);
  });
  test('markov is deterministic with a fixed rng', () => {
    let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const a = markov('a b c d e f g h i j k l m n o p', 10, 2, r);
    s = 7;
    expect(markov('a b c d e f g h i j k l m n o p', 10, 2, r)).toBe(a);
  });
  test('pickChain gives distinct non-English languages', () => {
    for (let n = 1; n <= 10; n++) { const c = pickChain(n); expect(new Set(c).size).toBe(n); expect(c).not.toContain('en'); }
    expect(pickChain(500).length).toBeLessThan(60);
  });
  test('ascii art renders every font and rejects bad input', () => {
    for (const f of ASCII_FONTS) { const a = asciify('Hi', f); expect(a.split('\n').length, f).toBeGreaterThan(2); expect(a.length).toBeLessThan(1900); }
    expect(() => asciify('   ')).toThrow();
    expect(() => asciify('hi', 'NotAFont')).toThrow(/font/i);
    expect(asciify('x'.repeat(100)).length).toBeLessThan(3000); // input capped at 30 chars
  });
  test('compatibility is stable, symmetric and in range', () => {
    for (const [a, b] of [['a', 'b'], ['alice', 'bob'], ['x', 'x'], ['', 'z']]) {
      const s = compatibility(a!, b!);
      expect(s).toBeGreaterThanOrEqual(0); expect(s).toBeLessThanOrEqual(100);
      expect(compatibility(b!, a!)).toBe(s);
      expect(compatibility(a!, b!)).toBe(s);
    }
    expect(new Set(Array.from({ length: 200 }, (_, i) => compatibility(`u${i}`, 'v'))).size).toBeGreaterThan(50); // spread out
    expect(dailyRating('u', '2026-01-01')).toBe(dailyRating('u', '2026-01-01'));
    expect(shipName('Alexander', 'Beatrice')).toBe('AlexaBeatrice'.slice(0, 5) + 'Beatrice'.slice(4));
    expect(heartBar(50)).toBe('❤️'.repeat(5) + '🖤'.repeat(5));
    expect(heartBar(0)).toBe('🖤'.repeat(10));
  });
});
