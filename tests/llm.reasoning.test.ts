import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { REASONING_HEADROOM, chat, reasoningEffort } from '../src/services/llm';

beforeEach(() => { Bun.env.LLM_BASE_URL = 'http://x/v1'; Bun.env.LLM_MODEL = 'plain-model'; });
afterEach(() => { for (const k of ['LLM_REASONING_EFFORT', 'LLM_MODEL', 'LLAMA_MODEL']) delete Bun.env[k]; });

/** A fetch stand-in that records the request body and answers with `content`. */
function capture(content: string | null = 'ok') {
  const seen: any[] = [];
  const fetchImpl = (async (_url: unknown, init: RequestInit) => { seen.push(JSON.parse(String(init.body))); return Response.json({ choices: [{ message: { content } }] }); }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

describe('reasoning models', () => {
  test('gpt-oss gets low effort and headroom for its hidden thinking, so a small cap cannot starve the answer', async () => {
    Bun.env.LLM_MODEL = 'openai/gpt-oss-120b';
    const c = capture();
    await chat([{ role: 'user', content: 'hi' }], { maxTokens: 30, fetchImpl: c.fetchImpl });
    expect(c.seen[0]).toMatchObject({ model: 'openai/gpt-oss-120b', reasoning_effort: 'low', max_tokens: 30 + REASONING_HEADROOM });
    await chat([{ role: 'user', content: 'hi' }], { fetchImpl: c.fetchImpl });
    expect(c.seen[1].max_tokens).toBe(700 + REASONING_HEADROOM);
  });
  test('other models are left exactly as before', async () => {
    const c = capture();
    await chat([{ role: 'user', content: 'hi' }], { maxTokens: 30, fetchImpl: c.fetchImpl });
    expect(c.seen[0].max_tokens).toBe(30); expect(c.seen[0]).not.toHaveProperty('reasoning_effort');
  });
  test('the model used for a request decides, including a per-call override', async () => {
    const c = capture();
    await chat([{ role: 'user', content: 'hi' }], { model: 'openai/gpt-oss-20b', maxTokens: 50, fetchImpl: c.fetchImpl });
    expect(c.seen[0]).toMatchObject({ model: 'openai/gpt-oss-20b', reasoning_effort: 'low', max_tokens: 50 + REASONING_HEADROOM });
  });
  test('LLM_REASONING_EFFORT overrides, applies to any model, and "off" sends nothing', () => {
    expect(reasoningEffort('openai/gpt-oss-120b')).toBe('low'); expect(reasoningEffort('qwen/qwen3.8-27b')).toBeNull();
    Bun.env.LLM_REASONING_EFFORT = 'High'; expect(reasoningEffort('openai/gpt-oss-120b')).toBe('high'); expect(reasoningEffort('anything')).toBe('high');
    Bun.env.LLM_REASONING_EFFORT = 'off'; expect(reasoningEffort('openai/gpt-oss-120b')).toBeNull();
  });
  test('an empty answer is still reported as an error instead of an empty message', async () => {
    Bun.env.LLM_MODEL = 'openai/gpt-oss-120b';
    await expect(chat([{ role: 'user', content: 'hi' }], { fetchImpl: capture(null).fetchImpl })).rejects.toThrow('empty reply');
  });
});
