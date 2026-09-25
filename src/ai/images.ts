import { getBufferPublic, HttpError } from '../framework/http.js';
import { LlmUnavailable } from '../services/llm.js';

/**
 * Image generation and editing for /ai imagine and /ai edit-imagine, through any OpenAI-compatible images API
 * (IMAGE_BASE_URL + IMAGE_API_KEY: Together, OpenAI, a local server…). Each of Heist's model choices maps to a model id set in
 * the environment; a model id starting with `chat:` is sent to /chat/completions with image output instead (how OpenRouter
 * serves Gemini's "Nano Banana" image models).
 */

/** Heist's /ai imagine choices → the env var holding the model id, and a sensible default for providers that host it. */
export const IMAGINE_MODELS = {
  'Flux (2-klein)': { env: 'IMAGE_MODEL_FLUX2_KLEIN', fallback: null },
  'Flux (1-schnell)': { env: 'IMAGE_MODEL_FLUX1_SCHNELL', fallback: 'black-forest-labs/FLUX.1-schnell' },
  'P Image': { env: 'IMAGE_MODEL_P_IMAGE', fallback: null },
  'Nano Banana 2': { env: 'IMAGE_MODEL_NANO_BANANA_2', fallback: null },
} as const;
export type ImagineModel = keyof typeof IMAGINE_MODELS;

export class ImageUnavailable extends LlmUnavailable {}

function endpoint(): { baseUrl: string; apiKey: string } {
  const baseUrl = Bun.env.IMAGE_BASE_URL?.replace(/\/+$/, '');
  if (!baseUrl) throw new ImageUnavailable('Image generation isn\'t set up on this bot yet (it needs IMAGE_BASE_URL).');
  return { baseUrl, apiKey: Bun.env.IMAGE_API_KEY ?? '' };
}

export function imagineModelId(choice: ImagineModel): string | null {
  const m = IMAGINE_MODELS[choice];
  return Bun.env[m.env]?.trim() || (Bun.env.IMAGE_BASE_URL ? m.fallback : null);
}

type Fetch = typeof fetch;
const headers = (key: string, json = true): Record<string, string> => ({ ...(json ? { 'Content-Type': 'application/json' } : {}), ...(key ? { Authorization: `Bearer ${key}` } : {}) });

async function fail(res: Response, what: string): Promise<never> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } | string } | null;
  const detail = typeof body?.error === 'string' ? body.error : body?.error?.message;
  if (/safety|policy|moderat|nsfw|content/i.test(detail ?? '')) throw new HttpError(res.status, what, 'The image service refused that prompt.');
  throw new HttpError(res.status, what, `Image service error ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`);
}

/** An image out of an images-API reply ({ data: [{ b64_json | url }] }) or a chat reply with images. */
export async function imageFromReply(body: unknown): Promise<Buffer> {
  const b = body as { data?: { b64_json?: string; url?: string }[]; choices?: { message?: { images?: { image_url?: { url?: string } }[]; content?: unknown } }[] };
  const d = b.data?.[0];
  if (d?.b64_json) return Buffer.from(d.b64_json, 'base64');
  const url = d?.url ?? b.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (url?.startsWith('data:')) return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  if (url) return getBufferPublic(url, { maxBytes: 20 * 1024 * 1024, timeoutMs: 30_000 }); // SSRF-checked like any other link
  throw new Error('The image service didn\'t return an image.');
}

async function viaChat(model: string, content: unknown, fetchImpl: Fetch): Promise<Buffer> {
  const { baseUrl, apiKey } = endpoint();
  const res = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST', headers: headers(apiKey), signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({ model, modalities: ['image', 'text'], messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) await fail(res, baseUrl);
  return imageFromReply(await res.json());
}

export async function imagine(choice: ImagineModel, prompt: string, fetchImpl: Fetch = fetch): Promise<Buffer> {
  const { baseUrl, apiKey } = endpoint();
  const model = imagineModelId(choice);
  if (!model) throw new ImageUnavailable(`**${choice}** isn't set up on this bot (${IMAGINE_MODELS[choice].env}).`);
  if (model.startsWith('chat:')) return viaChat(model.slice(5), prompt, fetchImpl);
  const res = await fetchImpl(`${baseUrl}/images/generations`, {
    method: 'POST', headers: headers(apiKey), signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({ model, prompt, n: 1, size: '1024x1024', response_format: 'b64_json' }),
  });
  if (!res.ok) await fail(res, baseUrl);
  return imageFromReply(await res.json());
}

/** Edit a picture with an instruction (IMAGE_EDIT_MODEL): multipart /images/edits, or a `chat:` image model. */
export async function editImage(png: Buffer, prompt: string, fetchImpl: Fetch = fetch): Promise<Buffer> {
  const { baseUrl, apiKey } = endpoint();
  const model = Bun.env.IMAGE_EDIT_MODEL?.trim();
  if (!model) throw new ImageUnavailable('Image editing isn\'t set up on this bot (it needs IMAGE_EDIT_MODEL).');
  if (model.startsWith('chat:')) return viaChat(model.slice(5), [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } }], fetchImpl);
  const form = new FormData();
  form.set('model', model); form.set('prompt', prompt); form.set('n', '1');
  form.set('image', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'image.png');
  const res = await fetchImpl(`${baseUrl}/images/edits`, { method: 'POST', headers: headers(apiKey, false), body: form, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) await fail(res, baseUrl);
  return imageFromReply(await res.json());
}
