import { getJson } from '../framework/http.js';
import { LookupError } from './handler.js';

/** Unit conversion (pure table-driven) plus currency conversion through open.er-api.com (keyless, updated daily). */

interface Unit { cat: string; toBase: number; label: string; aliases: string[] }

const U = (cat: string, label: string, toBase: number, ...aliases: string[]): Unit => ({ cat, label, toBase, aliases });
const UNITS: Unit[] = [
  U('length', 'mm', 0.001, 'millimeter', 'millimeters', 'millimetre', 'millimetres'), U('length', 'cm', 0.01, 'centimeter', 'centimeters', 'centimetre', 'centimetres'),
  U('length', 'm', 1, 'meter', 'meters', 'metre', 'metres'), U('length', 'km', 1000, 'kilometer', 'kilometers', 'kilometre', 'kilometres'),
  U('length', 'in', 0.0254, 'inch', 'inches', '"'), U('length', 'ft', 0.3048, 'foot', 'feet', "'"), U('length', 'yd', 0.9144, 'yard', 'yards'),
  U('length', 'mi', 1609.344, 'mile', 'miles'), U('length', 'nmi', 1852, 'nauticalmile', 'nauticalmiles'),
  U('mass', 'mg', 1e-6, 'milligram', 'milligrams'), U('mass', 'g', 0.001, 'gram', 'grams'), U('mass', 'kg', 1, 'kilogram', 'kilograms', 'kilo', 'kilos'), U('mass', 't', 1000, 'tonne', 'tonnes', 'metricton'),
  U('mass', 'oz', 0.028349523125, 'ounce', 'ounces'), U('mass', 'lb', 0.45359237, 'lbs', 'pound', 'pounds'), U('mass', 'st', 6.35029318, 'stone', 'stones'),
  U('volume', 'ml', 0.001, 'milliliter', 'milliliters', 'millilitre', 'millilitres'), U('volume', 'l', 1, 'liter', 'liters', 'litre', 'litres'),
  U('volume', 'gal', 3.785411784, 'gallon', 'gallons'), U('volume', 'qt', 0.946352946, 'quart', 'quarts'), U('volume', 'pt', 0.473176473, 'pint', 'pints'),
  U('volume', 'cup', 0.2365882365, 'cups'), U('volume', 'fl oz', 0.0295735295625, 'floz', 'fluidounce', 'fluidounces'), U('volume', 'tbsp', 0.01478676478125, 'tablespoon', 'tablespoons'), U('volume', 'tsp', 0.00492892159375, 'teaspoon', 'teaspoons'),
  U('speed', 'm/s', 1, 'mps', 'meterspersecond'), U('speed', 'km/h', 1 / 3.6, 'kph', 'kmh', 'kmph'), U('speed', 'mph', 0.44704, 'milesperhour'), U('speed', 'kn', 1852 / 3600, 'knot', 'knots', 'kt'), U('speed', 'ft/s', 0.3048, 'fps'),
  U('area', 'm²', 1, 'm2', 'sqm', 'squaremeter', 'squaremeters'), U('area', 'km²', 1e6, 'km2', 'sqkm'), U('area', 'ha', 1e4, 'hectare', 'hectares'), U('area', 'acre', 4046.8564224, 'acres'),
  U('area', 'ft²', 0.09290304, 'ft2', 'sqft', 'squarefeet', 'squarefoot'), U('area', 'in²', 6.4516e-4, 'in2', 'sqin'), U('area', 'mi²', 2589988.110336, 'mi2', 'sqmi'),
  U('data', 'bit', 0.125, 'bits'), U('data', 'B', 1, 'byte', 'bytes'), U('data', 'KB', 1e3, 'kilobyte', 'kilobytes'), U('data', 'MB', 1e6, 'megabyte', 'megabytes'), U('data', 'GB', 1e9, 'gigabyte', 'gigabytes'), U('data', 'TB', 1e12, 'terabyte', 'terabytes'),
  U('data', 'KiB', 1024, 'kibibyte'), U('data', 'MiB', 1024 ** 2, 'mebibyte'), U('data', 'GiB', 1024 ** 3, 'gibibyte'), U('data', 'TiB', 1024 ** 4, 'tebibyte'),
  U('time', 'ms', 0.001, 'millisecond', 'milliseconds'), U('time', 's', 1, 'sec', 'second', 'seconds', 'secs'), U('time', 'min', 60, 'minute', 'minutes', 'mins'), U('time', 'h', 3600, 'hr', 'hour', 'hours', 'hrs'),
  U('time', 'day', 86400, 'd', 'days'), U('time', 'week', 604800, 'w', 'wk', 'weeks'), U('time', 'year', 31557600, 'y', 'yr', 'years', 'yrs'),
  U('temperature', '°C', 1, 'c', 'celsius', 'degc', '°c'), U('temperature', '°F', 1, 'f', 'fahrenheit', 'degf', '°f'), U('temperature', 'K', 1, 'k', 'kelvin'),
];

/** Case-sensitive symbols that would collide once lowercased ("MB" megabyte vs "mb"); everything else matches case-insensitively. */
const CASE_SENSITIVE = new Map(UNITS.filter(u => u.cat === 'data').map(u => [u.label, u]));
const BY_KEY = new Map<string, Unit>();
for (const u of UNITS) for (const k of [u.label, ...u.aliases]) if (!BY_KEY.has(k.toLowerCase().replace(/\s+/g, ''))) BY_KEY.set(k.toLowerCase().replace(/\s+/g, ''), u);

export function findUnit(name: string): Unit | undefined {
  const n = name.trim();
  return CASE_SENSITIVE.get(n) ?? BY_KEY.get(n.toLowerCase().replace(/\s+/g, ''));
}

function toC(v: number, u: string): number { return u === '°F' ? ((v - 32) * 5) / 9 : u === 'K' ? v - 273.15 : v; }
function fromC(c: number, u: string): number { return u === '°F' ? (c * 9) / 5 + 32 : u === 'K' ? c + 273.15 : c; }

export interface UnitResult { value: number; from: string; to: string; result: number; category: string }

export function convertUnits(value: number, fromName: string, toName: string): UnitResult {
  if (!Number.isFinite(value)) throw new LookupError('That isn\'t a number I can convert.');
  const a = findUnit(fromName), b = findUnit(toName);
  if (!a) throw new LookupError(`I don't know the unit "${fromName.slice(0, 30)}".`);
  if (!b) throw new LookupError(`I don't know the unit "${toName.slice(0, 30)}".`);
  if (a.cat !== b.cat) throw new LookupError(`You can't convert ${a.cat} (${a.label}) to ${b.cat} (${b.label}).`);
  const result = a.cat === 'temperature' ? fromC(toC(value, a.label), b.label) : (value * a.toBase) / b.toBase;
  return { value, from: a.label, to: b.label, result, category: a.cat };
}

export const CATEGORIES = [...new Set(UNITS.map(u => u.cat))];
export const unitsOf = (cat: string) => UNITS.filter(u => u.cat === cat).map(u => u.label);

/** "5 km to mi", "72 f in c", "10 lb → kg". */
export function parseConversion(input: string): { value: number; from: string; to: string } {
  const m = /^\s*(-?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?)\s*([^\d\s][^]*?)\s+(?:to|in|into|as|->|→)\s+([^]+?)\s*$/i.exec(input);
  if (!m) throw new LookupError('Try something like `5 km to mi`, `72 f to c` or `100 usd to eur`.');
  return { value: Number(m[1]!.replace(',', '.')), from: m[2]!, to: m[3]! };
}

export function formatAmount(n: number): string {
  if (n === 0) return '0';
  const a = Math.abs(n);
  if (a >= 1e15 || a < 1e-6) return n.toExponential(4);
  if (a >= 1000) return Number(n.toPrecision(12)).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return String(a >= 1 ? Number(n.toFixed(4)) : Number(n.toPrecision(6)));
}

// ─── Currency ────────────────────────────────────────────────────────────────

export interface Rates { base: string; updated: string; rates: Record<string, number> }

export async function fxRates(base = 'USD'): Promise<Rates> {
  const r = await getJson<{ result: string; base_code: string; time_last_update_utc: string; rates: Record<string, number> }>(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`, { cacheMs: 60 * 60_000 });
  if (r.result !== 'success') throw new LookupError(`I couldn't get exchange rates for ${base}.`);
  return { base: r.base_code, updated: r.time_last_update_utc, rates: r.rates };
}

export const isCurrencyCode = (s: string) => /^[A-Za-z]{3}$/.test(s.trim());

export function applyRate(value: number, from: string, to: string, rates: Record<string, number>): number {
  if (!Object.hasOwn(rates, to)) throw new LookupError(`I don't know the currency "${to}".`);
  if (from !== 'USD' && !Object.hasOwn(rates, from)) throw new LookupError(`I don't know the currency "${from}".`);
  return (value / (from === 'USD' ? 1 : rates[from]!)) * rates[to]!;
}

export async function convertCurrency(value: number, fromCode: string, toCode: string): Promise<{ result: number; rate: number; updated: string; from: string; to: string }> {
  const from = fromCode.trim().toUpperCase(), to = toCode.trim().toUpperCase();
  if (!Number.isFinite(value) || Math.abs(value) > 1e15) throw new LookupError('That amount doesn\'t look right.');
  const { rates, updated } = await fxRates(from);
  if (!Object.hasOwn(rates, from)) throw new LookupError(`I don't know the currency "${from}".`);
  const rate = applyRate(1, from, to, rates);
  return { result: value * rate, rate, updated, from, to };
}

/** Handles both units and currencies from one free-text string. */
export async function convertAny(input: string): Promise<{ text: string; note?: string }> {
  const { value, from, to } = parseConversion(input);
  const a = findUnit(from), b = findUnit(to);
  if (a || b) {
    const r = convertUnits(value, from, to);
    return { text: `**${formatAmount(value)} ${r.from}** = **${formatAmount(r.result)} ${r.to}**`, note: r.category };
  }
  if (isCurrencyCode(from) && isCurrencyCode(to)) {
    const r = await convertCurrency(value, from, to);
    return { text: `**${formatAmount(value)} ${r.from}** = **${formatAmount(r.result)} ${r.to}**`, note: `1 ${r.from} = ${formatAmount(r.rate)} ${r.to} · rates updated ${r.updated.replace(/ \+0000$/, ' UTC')}` };
  }
  throw new LookupError(`I don't know how to convert "${from.slice(0, 20)}" to "${to.slice(0, 20)}".`);
}
