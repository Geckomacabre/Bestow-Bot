import { beforeAll, describe, expect, test } from 'bun:test';
import { initDb } from '../src/utils/db';
import { editImage, imagine, imageFromReply, imagineModelId } from '../src/ai/images';
import { openaiSpeech, parseSonar, sonar } from '../src/ai/services';
import * as custom from '../src/ai/custom';
import { localeLang, toolsFor } from '../src/ai/menus';
import * as qp from '../src/quotes/presets';
import { DEFAULT_QUOTE_STYLE, generateQuote } from '../src/utils/quote';

beforeAll(async () => { await initDb(); });

/** Run `fn` with some env vars set (undefined = unset), restoring them after. */
async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const saved = Object.fromEntries(Object.keys(env).map(k => [k, Bun.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete Bun.env[k]; else Bun.env[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete Bun.env[k]; else Bun.env[k] = v; } }
}
const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==', 'base64');

describe('/ai imagine and edit-imagine', () => {
  test('images come back as base64, a data URI, or from a chat reply', async () => {
    expect((await imageFromReply({ data: [{ b64_json: png1x1.toString('base64') }] })).equals(png1x1)).toBe(true);
    expect((await imageFromReply({ choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${png1x1.toString('base64')}` } }] } }] })).equals(png1x1)).toBe(true);
    await expect(imageFromReply({ data: [] })).rejects.toThrow(/didn't return an image/);
  });
  test('Heist\'s model choices map to env model ids; unset ones say so', async () => {
    await withEnv({ IMAGE_BASE_URL: 'https://img.test/v1', IMAGE_MODEL_P_IMAGE: undefined, IMAGE_MODEL_FLUX1_SCHNELL: undefined }, async () => {
      expect(imagineModelId('Flux (1-schnell)')).toBe('black-forest-labs/FLUX.1-schnell');
      await expect(imagine('P Image', 'a cat')).rejects.toThrow(/P Image.*isn't set up/);
    });
    await withEnv({ IMAGE_BASE_URL: undefined }, () => expect(imagine('Flux (1-schnell)', 'x')).rejects.toThrow(/IMAGE_BASE_URL/));
  });
  test('the images API request, and chat: models going to /chat/completions', async () => {
    const calls: { url: string; body: any }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
      return Response.json(url.endsWith('/chat/completions') ? { choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${png1x1.toString('base64')}` } }] } }] } : { data: [{ b64_json: png1x1.toString('base64') }] });
    }) as unknown as typeof fetch;
    await withEnv({ IMAGE_BASE_URL: 'https://img.test/v1/', IMAGE_API_KEY: 'k', IMAGE_MODEL_NANO_BANANA_2: 'chat:google/gemini-image', IMAGE_EDIT_MODEL: 'gpt-image-1' }, async () => {
      expect((await imagine('Flux (1-schnell)', 'a cat', fake)).equals(png1x1)).toBe(true);
      expect(calls[0]).toMatchObject({ url: 'https://img.test/v1/images/generations', body: { model: 'black-forest-labs/FLUX.1-schnell', prompt: 'a cat', response_format: 'b64_json' } });
      await imagine('Nano Banana 2', 'a dog', fake);
      expect(calls[1]).toMatchObject({ url: 'https://img.test/v1/chat/completions', body: { model: 'google/gemini-image', modalities: ['image', 'text'] } });
      await editImage(png1x1, 'make it blue', fake);
      expect(calls[2]!.url).toBe('https://img.test/v1/images/edits');
      expect((calls[2]!.body as FormData).get('model')).toBe('gpt-image-1');
    });
  });
});

describe('/ai perplexity and tts openai', () => {
  test('Sonar answers with sources from search_results or bare citations', () => {
    expect(parseSonar({ choices: [{ message: { content: 'Paris.' } }], search_results: [{ title: 'Paris', url: 'https://en.wikipedia.org/wiki/Paris' }] }))
      .toEqual({ text: 'Paris.', sources: [{ title: 'Paris', url: 'https://en.wikipedia.org/wiki/Paris' }] });
    expect(parseSonar({ choices: [{ message: { content: 'x' } }], citations: ['https://www.example.com/a'] }).sources).toEqual([{ title: 'example.com', url: 'https://www.example.com/a' }]);
    expect(() => parseSonar({ choices: [] })).toThrow(/empty/);
  });
  test('Sonar and OpenAI voices need their keys; the speech request is OpenAI-shaped', async () => {
    await withEnv({ PERPLEXITY_API_KEY: undefined }, () => expect(sonar('q', null)).rejects.toThrow(/PERPLEXITY_API_KEY/));
    await withEnv({ OPENAI_API_KEY: undefined, OPENAI_TTS_BASE_URL: undefined }, () => expect(openaiSpeech('hi', 'Nova')).rejects.toThrow(/OPENAI_API_KEY/));
    let seen: any;
    const fake = (async (url: string, init: RequestInit) => { seen = { url, body: JSON.parse(init.body as string) }; return new Response(new Uint8Array([1, 2, 3])); }) as unknown as typeof fetch;
    await withEnv({ OPENAI_API_KEY: 'k', OPENAI_TTS_BASE_URL: undefined }, async () => {
      expect((await openaiSpeech('hello', 'Nova', fake)).length).toBe(3);
      expect(seen).toMatchObject({ url: 'https://api.openai.com/v1/audio/speech', body: { voice: 'nova', input: 'hello', response_format: 'mp3' } });
    });
  });
});

describe('/ai custom', () => {
  test('models: CUSTOM_AI_MODELS "Label=id" list, else the bot\'s chat and Llama models', () => {
    expect(custom.customModels({ CUSTOM_AI_MODELS: 'Fast=llama-3.1-8b, Smart = gpt-4o , raw-id' })).toEqual([{ label: 'Fast', id: 'llama-3.1-8b' }, { label: 'Smart', id: 'gpt-4o' }, { label: 'raw-id', id: 'raw-id' }]);
  });
  test('build, pick a model, validation', async () => {
    const u = `cai-${Date.now()}`;
    await expect(custom.saveCustom(u, '  ', 'x')).rejects.toThrow(/name/);
    await expect(custom.saveCustom(u, 'Bob', 'x'.repeat(custom.MAX_INSTRUCTIONS + 1))).rejects.toThrow(/under/);
    const ai = await custom.saveCustom(u, 'Pirate  Pete', 'Talk like a pirate.');
    expect(ai).toEqual({ name: 'Pirate Pete', instructions: 'Talk like a pirate.', model: null });
    await withEnv({ CUSTOM_AI_MODELS: 'A=model-a,B=model-b' }, async () => {
      expect(custom.modelFor(ai)).toEqual({ label: 'A', id: 'model-a' });
      await custom.setCustomModel(u, 'model-b');
      expect(custom.modelFor((await custom.getCustom(u))!)).toEqual({ label: 'B', id: 'model-b' });
      await expect(custom.setCustomModel(u, 'nope')).rejects.toThrow(/isn't available/);
    });
  });
});

describe('message menus', () => {
  test('AI Tools offers text tools for text and image tools for images', () => {
    expect(toolsFor('hello', 0).map(t => t.id)).toEqual(['summarize', 'explain', 'replies', 'translate']);
    expect(toolsFor('', 1).map(t => t.id)).toEqual(['describe', 'ocr']);
    expect(toolsFor('hi', 2)).toHaveLength(6);
  });
  test('Translate Message goes into the reader\'s Discord language', () => {
    expect(['en-US', 'fr', 'pt-BR', 'zh-CN', 'es-419', undefined].map(l => localeLang(l))).toEqual(['en', 'fr', 'pt', 'zh-CN', 'es', 'en']);
  });
});

describe('quote presets', () => {
  test('create, style, apply, delete; one applied at a time; limits and bad names', async () => {
    const u = `qp-${Date.now()}`;
    expect(await qp.activeStyle(u)).toEqual(DEFAULT_QUOTE_STYLE);
    const a = await qp.createPreset(u, 'Clean  White');
    expect(a).toEqual({ name: 'Clean White', style: DEFAULT_QUOTE_STYLE, active: false });
    await expect(qp.createPreset(u, 'clean white')).rejects.toThrow(/already have/);
    await qp.updatePreset(u, 'Clean White', { theme: 'Light', font: 'Tempo', grayscale: false });
    await qp.createPreset(u, 'Other');
    expect(await qp.applyPreset(u, 'Clean White')).toBe(true);
    expect(await qp.activeStyle(u)).toEqual({ theme: 'Light', font: 'Tempo', grayscale: false, showHandle: true });
    await qp.applyPreset(u, 'Other');
    expect((await qp.listPresets(u)).map(p => [p.name, p.active])).toEqual([['Clean White', false], ['Other', true]]);
    expect(await qp.deletePreset(u, 'Other')).toBe(true);
    expect(await qp.activeStyle(u)).toEqual(DEFAULT_QUOTE_STYLE);
    expect(await qp.applyPreset(u, 'missing')).toBe(false);
    for (let n = 0; n < qp.MAX_PRESETS - 1; n++) await qp.createPreset(u, `p${n}`);
    await expect(qp.createPreset(u, 'one too many')).rejects.toThrow(/up to/);
  });
  test('stored styles are cleaned up on read', () => {
    expect(qp.parseStyle('{"theme":"Neon","font":"Comic Sans","grayscale":false}')).toEqual({ ...DEFAULT_QUOTE_STYLE, grayscale: false });
    expect(qp.parseStyle('not json')).toEqual(DEFAULT_QUOTE_STYLE);
  });
  test('every font and theme renders', async () => {
    for (const font of qp.QUOTE_FONTS) for (const theme of ['Dark', 'Light'] as const) {
      const png = await generateQuote({ text: 'hi **there**', authorName: 'A', authorHandle: '@a', authorAvatarUrl: null, style: { theme, font, grayscale: true, showHandle: false } });
      expect(png.subarray(1, 4).toString(), `${font} ${theme}`).toBe('PNG');
    }
  });
});
