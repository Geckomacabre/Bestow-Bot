/**
 * A small, safe expression evaluator for /math — a hand-written parser, never eval().
 * Supports + - * / % ^ (right-assoc), unary minus, parentheses, implicit multiplication (2pi, 3(4+1), (1+2)(3+4)),
 * constants (pi, e, tau, phi) and the usual functions.
 */

export class MathError extends Error {}

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string } | { t: '(' } | { t: ')' } | { t: ',' };

const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2, inf: Infinity };

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new MathError('Factorial needs a whole number ≥ 0.');
  if (n > 170) throw new MathError('That factorial is too large.');
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}
const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

const FUNCS: Record<string, { min: number; max: number; fn: (...a: number[]) => number }> = {
  sin: { min: 1, max: 1, fn: Math.sin }, cos: { min: 1, max: 1, fn: Math.cos }, tan: { min: 1, max: 1, fn: Math.tan },
  asin: { min: 1, max: 1, fn: Math.asin }, acos: { min: 1, max: 1, fn: Math.acos }, atan: { min: 1, max: 1, fn: Math.atan }, atan2: { min: 2, max: 2, fn: Math.atan2 },
  sinh: { min: 1, max: 1, fn: Math.sinh }, cosh: { min: 1, max: 1, fn: Math.cosh }, tanh: { min: 1, max: 1, fn: Math.tanh },
  sqrt: { min: 1, max: 1, fn: Math.sqrt }, cbrt: { min: 1, max: 1, fn: Math.cbrt }, abs: { min: 1, max: 1, fn: Math.abs },
  ln: { min: 1, max: 1, fn: Math.log }, log2: { min: 1, max: 1, fn: Math.log2 }, log10: { min: 1, max: 1, fn: Math.log10 },
  log: { min: 1, max: 2, fn: (x, b) => (b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b)) },
  exp: { min: 1, max: 1, fn: Math.exp }, floor: { min: 1, max: 1, fn: Math.floor }, ceil: { min: 1, max: 1, fn: Math.ceil }, trunc: { min: 1, max: 1, fn: Math.trunc },
  round: { min: 1, max: 2, fn: (x, d = 0) => { const m = 10 ** Math.min(15, Math.max(0, d)); return Math.round(x * m) / m; } },
  sign: { min: 1, max: 1, fn: Math.sign }, min: { min: 1, max: 20, fn: Math.min }, max: { min: 1, max: 20, fn: Math.max }, pow: { min: 2, max: 2, fn: Math.pow },
  hypot: { min: 1, max: 20, fn: Math.hypot }, mod: { min: 2, max: 2, fn: (a, b) => a % b }, fact: { min: 1, max: 1, fn: factorial }, factorial: { min: 1, max: 1, fn: factorial },
  deg: { min: 1, max: 1, fn: x => (x * 180) / Math.PI }, rad: { min: 1, max: 1, fn: x => (x * Math.PI) / 180 }, gcd: { min: 2, max: 2, fn: gcd },
  lcm: { min: 2, max: 2, fn: (a, b) => Math.abs(a * b) / (gcd(a, b) || 1) },
  avg: { min: 1, max: 20, fn: (...a) => a.reduce((s, x) => s + x, 0) / a.length },
};

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) { out.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i));
    if (id) { out.push({ t: 'id', v: id[0].toLowerCase() }); i += id[0].length; continue; }
    if ('+-*/%^!'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    if (c === '×') { out.push({ t: 'op', v: '*' }); i++; continue; }
    if (c === '÷') { out.push({ t: 'op', v: '/' }); i++; continue; }
    if (c === '(') { out.push({ t: '(' }); i++; continue; }
    if (c === ')') { out.push({ t: ')' }); i++; continue; }
    if (c === ',') { out.push({ t: ',' }); i++; continue; }
    throw new MathError(`I don't understand "${c}".`);
  }
  return out;
}

class Parser {
  private i = 0;
  private depth = 0;
  constructor(private toks: Tok[]) {}
  private peek() { return this.toks[this.i]; }
  private next() { return this.toks[this.i++]; }

  parse(): number {
    if (!this.toks.length) throw new MathError('Type an expression, like `2*(3+4)^2`.');
    const v = this.expr();
    if (this.i < this.toks.length) throw new MathError('There\'s something extra at the end of that expression.');
    return v;
  }
  private expr(): number {
    let v = this.term();
    for (let t = this.peek(); t && t.t === 'op' && (t.v === '+' || t.v === '-'); t = this.peek()) {
      this.next();
      const r = this.term();
      v = t.v === '+' ? v + r : v - r;
    }
    return v;
  }
  private term(): number {
    let v = this.unary();
    for (;;) {
      const t = this.peek();
      if (t && t.t === 'op' && (t.v === '*' || t.v === '/' || t.v === '%')) {
        this.next();
        const r = this.unary();
        if (t.v === '/' && r === 0) throw new MathError('Division by zero.');
        v = t.v === '*' ? v * r : t.v === '/' ? v / r : v % r;
      } else if (t && (t.t === '(' || t.t === 'id' || t.t === 'num')) {
        v *= this.unary(); // implicit multiplication: 2pi, 3(4), (1)(2)
      } else return v;
    }
  }
  private unary(): number {
    const t = this.peek();
    if (t && t.t === 'op' && (t.v === '-' || t.v === '+')) { this.next(); const v = this.unary(); return t.v === '-' ? -v : v; }
    return this.power();
  }
  private power(): number {
    let base = this.postfix();
    const t = this.peek();
    if (t && t.t === 'op' && t.v === '^') { this.next(); base = base ** this.unary(); } // right-associative, binds tighter than unary minus on the base
    return base;
  }
  private postfix(): number {
    let v = this.atom();
    while (this.peek()?.t === 'op' && (this.peek() as { v: string }).v === '!') { this.next(); v = factorial(v); }
    return v;
  }
  private atom(): number {
    const t = this.next();
    if (!t) throw new MathError('That expression ends too early.');
    if (t.t === 'num') return t.v;
    if (t.t === '(') {
      if (++this.depth > 40) throw new MathError('Too many nested parentheses.');
      const v = this.expr();
      if (this.next()?.t !== ')') throw new MathError('A parenthesis isn\'t closed.');
      this.depth--;
      return v;
    }
    if (t.t === 'id') {
      if (this.peek()?.t === '(') {
        const f = Object.hasOwn(FUNCS, t.v) ? FUNCS[t.v] : undefined; // own-property check: "constructor(" must not resolve via the prototype chain
        if (!f) throw new MathError(`I don't know a function called "${t.v}".`);
        this.next();
        const args: number[] = [];
        if (this.peek()?.t !== ')') for (;;) { args.push(this.expr()); if (this.peek()?.t === ',') { this.next(); continue; } break; }
        if (this.next()?.t !== ')') throw new MathError('A parenthesis isn\'t closed.');
        if (args.length < f.min || args.length > f.max) throw new MathError(`${t.v}() takes ${f.min === f.max ? f.min : `${f.min}–${f.max}`} argument(s).`);
        return f.fn(...args);
      }
      if (Object.hasOwn(CONSTS, t.v)) return CONSTS[t.v]!;
      throw new MathError(`I don't know "${t.v}".`);
    }
    throw new MathError('That expression doesn\'t make sense.');
  }
}

export const MAX_EXPR = 200;

export function evaluate(expr: string): number {
  const s = expr.trim();
  if (s.length > MAX_EXPR) throw new MathError(`Keep expressions under ${MAX_EXPR} characters.`);
  const v = new Parser(tokenize(s)).parse();
  if (Number.isNaN(v)) throw new MathError('That has no real result.');
  return v;
}

/** Up to 12 significant digits, no float noise (0.1+0.2 → 0.3), exponent form for huge/tiny values. */
export function formatNumber(v: number): string {
  if (v === Infinity) return '∞';
  if (v === -Infinity) return '−∞';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e15 || a < 1e-9) return v.toExponential(8).replace(/\.?0+e/, 'e');
  const rounded = Number(v.toPrecision(12));
  return Number.isInteger(rounded) ? rounded.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(rounded);
}
