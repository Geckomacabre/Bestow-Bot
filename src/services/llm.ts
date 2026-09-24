import { HttpError } from '../framework/http.js';

/**
 * Minimal OpenAI-compatible chat client (works with xAI/Grok, Groq, OpenAI, OpenRouter, Ollama, LM Studio…).
 * Configure with env: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL (and optionally VISION_MODEL, VISION_BASE_URL, VISION_API_KEY).
 */

export type TextPart = { type: 'text'; text: string };
export type ImagePart = { type: 'image_url'; image_url: { url: string } };
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string | (TextPart | ImagePart)[] };

export interface LlmConfig { baseUrl: string; apiKey: string; model: string }

export function llmConfig(kind: 'chat' | 'vision' = 'chat'): LlmConfig | null {
  const baseUrl = (kind === 'vision' ? Bun.env.VISION_BASE_URL : undefined) ?? Bun.env.LLM_BASE_URL;
  const apiKey = (kind === 'vision' ? Bun.env.VISION_API_KEY : undefined) ?? Bun.env.LLM_API_KEY;
  const model = (kind === 'vision' ? Bun.env.VISION_MODEL : undefined) ?? Bun.env.LLM_MODEL;
  if (!baseUrl || !model) return null;
  // Local servers (Ollama, LM Studio) don't need a key.
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey: apiKey ?? '', model };
}

export const llmConfigured = (kind: 'chat' | 'vision' = 'chat') => llmConfig(kind) !== null;

export class LlmUnavailable extends Error {
  constructor(message = 'The AI isn\'t configured on this bot yet.') { super(message); this.name = 'LlmUnavailable'; }
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  kind?: 'chat' | 'vision';
  model?: string;
  timeoutMs?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
}

interface ChatResponse { choices?: { message?: { content?: string | null }; finish_reason?: string }[]; error?: { message?: string } }

export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const cfg = llmConfig(opts.kind ?? 'chat');
  if (!cfg) throw new LlmUnavailable();
  const doFetch = opts.fetchImpl ?? fetch;
  const body = JSON.stringify({
    model: opts.model ?? cfg.model,
    messages,
    temperature: opts.temperature ?? 0.9,
    max_tokens: opts.maxTokens ?? 700,
    ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 60_000);
    try {
      const res = await doFetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
        body,
        signal: ctrl.signal,
      });
      if (res.status === 429 && attempt === 0) { await Bun.sleep(1500); continue; }
      if (!res.ok) {
        const detail = ((await res.json().catch(() => null)) as ChatResponse | null)?.error?.message;
        throw new HttpError(res.status, cfg.baseUrl, `AI service error ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`);
      }
      const data = (await res.json()) as ChatResponse;
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error('The AI returned an empty reply.');
      return text;
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new Error('The AI took too long to answer.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('The AI is rate-limited right now — try again in a moment.');
}

/** One-shot helper: system prompt + user prompt → text. */
export const ask = (system: string, user: string, opts: ChatOptions = {}) =>
  chat([{ role: 'system', content: system }, { role: 'user', content: user }], opts);

/** Pull the first JSON object/array out of a model reply (models like to wrap JSON in prose or code fences). */
export function extractJson<T = unknown>(text: string): T | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const candidates = [fenced, text].filter((x): x is string => !!x);
  for (const c of candidates) {
    const start = c.search(/[[{]/);
    if (start < 0) continue;
    for (let end = c.length; end > start; end--) {
      const ch = c[end - 1];
      if (ch !== '}' && ch !== ']') continue;
      try { return JSON.parse(c.slice(start, end)) as T; } catch { /* keep shrinking */ }
    }
  }
  return null;
}

/** Keep model text inside Discord's limits and never let it ping @everyone/@here/roles. */
export function sanitizeReply(text: string, max = 1900): string {
  const safe = text.replace(/@(everyone|here)/gi, '@​$1').replace(/<@&(\d+)>/g, '<@&​$1>');
  return safe.length > max ? `${safe.slice(0, max - 1)}…` : safe;
}
