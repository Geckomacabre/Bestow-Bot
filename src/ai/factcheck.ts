import { chat, extractJson, type ChatOptions } from '../services/llm.js';
import { search, type SearchHit } from '../lookups/web.js';
import { LookupError } from '../lookups/handler.js';
import { FACTCHECK_SYSTEM } from './prompts.js';

export type Verdict = 'true' | 'mostly true' | 'misleading' | 'false' | 'unverifiable';
export const VERDICTS: Verdict[] = ['true', 'mostly true', 'misleading', 'false', 'unverifiable'];

export interface FactCheck { claim: string; verdict: Verdict; confidence: number; explanation: string; sources: { title: string; url: string }[]; engine: string }

const STOP = new Set('a an the is are was were be been being of in on at to for from by with about as into that this these those it its and or but not no do does did has have had will would can could should may might i you he she we they them his her their our your what which who whom when where why how than then so if there here very just really also only over under more most some any all each other such own same too'.split(' '));

/** A short search query from a claim: its distinctive words, in order. */
export function keywords(claim: string, max = 8): string {
  const words = claim.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w));
  return [...new Set(words)].slice(0, max).join(' ');
}

export function evidenceBlock(hits: SearchHit[]): string {
  return hits.map((h, i) => `[${i + 1}] ${h.title} — ${h.snippet} (${h.url})`).join('\n');
}

export function parseVerdict(raw: string, hits: SearchHit[]): { verdict: Verdict; confidence: number; explanation: string; sources: { title: string; url: string }[] } {
  const j = extractJson<{ verdict?: string; confidence?: number; explanation?: string; sources?: unknown }>(raw);
  if (!j) throw new LookupError('The AI\'s answer wasn\'t in a form I could read. Try rephrasing the claim.');
  const v = String(j.verdict ?? '').toLowerCase().trim() as Verdict;
  const verdict = VERDICTS.includes(v) ? v : 'unverifiable';
  const conf = Number(j.confidence);
  const used = Array.isArray(j.sources) ? j.sources.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= hits.length) : [];
  return {
    verdict, confidence: Number.isFinite(conf) ? Math.max(0, Math.min(100, Math.round(conf))) : 0,
    explanation: String(j.explanation ?? '').trim().slice(0, 700) || 'No explanation was given.',
    sources: [...new Set(used)].map(n => ({ title: hits[n - 1]!.title, url: hits[n - 1]!.url })),
  };
}

export async function factcheck(claim: string, opts: ChatOptions & { searchImpl?: typeof search } = {}): Promise<FactCheck> {
  const c = claim.trim();
  if (c.length < 8 || c.length > 400) throw new LookupError('Give me a claim to check (8–400 characters).');
  const q = keywords(c);
  let found: { hits: SearchHit[]; engine: string };
  try { found = await (opts.searchImpl ?? search)(q || c, 5); } catch (e) {
    if (e instanceof LookupError) return { claim: c, verdict: 'unverifiable', confidence: 0, explanation: 'I couldn\'t find any sources to check this against.', sources: [], engine: 'none' };
    throw e;
  }
  const raw = await chat([{ role: 'system', content: FACTCHECK_SYSTEM }, { role: 'user', content: `Claim: "${c}"\n\nEvidence:\n${evidenceBlock(found.hits)}` }], { ...opts, json: true, temperature: 0.1, maxTokens: 400 });
  return { claim: c, ...parseVerdict(raw, found.hits), engine: found.engine };
}
