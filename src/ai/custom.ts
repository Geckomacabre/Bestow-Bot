import { db } from '../utils/db.js';
import { llmConfig, modelLabel } from '../services/llm.js';

/** /ai custom: each person's own AI — a name, instructions they write, and a model from the ones this bot offers. */

export const MAX_NAME = 32;
export const MAX_INSTRUCTIONS = 1500;

export class CustomAiError extends Error {}

export interface CustomAi { name: string; instructions: string; model: string | null }
export interface ModelChoice { id: string; label: string }

/**
 * Models people can pick: CUSTOM_AI_MODELS ("Label=model-id, Label 2=model-id-2", all on the main LLM endpoint), else the bot's
 * chat model and its Llama model.
 */
export function customModels(env: Record<string, string | undefined> = Bun.env): ModelChoice[] {
  const listed = (env.CUSTOM_AI_MODELS ?? '').split(',').map(s => s.trim()).filter(Boolean).map(entry => {
    const [label, id] = entry.includes('=') ? entry.split('=').map(x => x.trim()) : [entry, entry];
    return { label: label!.slice(0, 80), id: id! };
  }).filter(m => m.id);
  if (listed.length) return listed.slice(0, 25);
  const out: ModelChoice[] = [];
  const chat = llmConfig('chat'), llama = llmConfig('llama');
  if (chat) out.push({ id: chat.model, label: modelLabel('chat') });
  if (llama && llama.model !== chat?.model) out.push({ id: llama.model, label: modelLabel('llama') });
  return out;
}

const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();

export async function getCustom(userId: string): Promise<CustomAi | null> {
  return ((await db`SELECT name, instructions, model FROM ai_custom WHERE user_id = ${userId}`) as CustomAi[])[0] ?? null;
}

export async function saveCustom(userId: string, name: string, instructions: string): Promise<CustomAi> {
  const n = clean(name).replace(/\s+/g, ' '), ins = clean(instructions);
  if (!n) throw new CustomAiError('Give your AI a name.');
  if (n.length > MAX_NAME) throw new CustomAiError(`Keep the name under ${MAX_NAME} characters.`);
  if (!ins) throw new CustomAiError('Tell your AI how to act.');
  if (ins.length > MAX_INSTRUCTIONS) throw new CustomAiError(`Keep the instructions under ${MAX_INSTRUCTIONS} characters.`);
  await db`INSERT INTO ai_custom (user_id, name, instructions, updated_at) VALUES (${userId}, ${n}, ${ins}, ${Date.now()})
    ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, instructions = excluded.instructions, updated_at = excluded.updated_at`;
  return (await getCustom(userId))!;
}

export async function setCustomModel(userId: string, model: string): Promise<boolean> {
  if (!customModels().some(m => m.id === model)) throw new CustomAiError('That model isn\'t available.');
  const r = await db`UPDATE ai_custom SET model = ${model}, updated_at = ${Date.now()} WHERE user_id = ${userId}`;
  return (r as unknown as { count?: number }).count !== 0;
}

/** The model a custom AI runs on: its pick if still offered, else the first on offer. */
export function modelFor(ai: CustomAi): ModelChoice | null {
  const models = customModels();
  return models.find(m => m.id === ai.model) ?? models[0] ?? null;
}
