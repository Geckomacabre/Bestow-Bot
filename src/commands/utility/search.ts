import { ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, type AutocompleteInteraction } from 'discord.js';
import { hgroup, hsub } from '../../framework/heist.js';
import { chunk, sendPages } from '../../framework/pages.js';
import { card, listCard, trunc, when } from '../../lookups/card.js';
import { lookup } from '../../lookups/handler.js';
import * as s from '../../lookups/search.js';
import { ask, llmConfigured, modelLabel, sanitizeReply } from '../../services/llm.js';
import { aiRun } from '../../subcommands/ai/ai.js';

const BLUE = 0x5865f2;
const q200 = { query: { maxLength: 200 } };

async function engineAutocomplete(i: AutocompleteInteraction) {
  const q = String(i.options.getFocused()).toLowerCase();
  await i.respond(s.ENGINES.filter(e => e.includes(q)).slice(0, 25).map(e => ({ name: e, value: e })));
}
async function aiEngineAutocomplete(i: AutocompleteInteraction) {
  const opts = [{ name: `ChatGPT (${modelLabel('chat')})`.slice(0, 100), value: 'chatgpt' }, ...(llmConfigured('llama') ? [{ name: `LLaMA (${modelLabel('llama')})`.slice(0, 100), value: 'llama' }] : [])];
  const q = String(i.options.getFocused()).toLowerCase();
  await i.respond(opts.filter(o => o.name.toLowerCase().includes(q)));
}
const engineOpt = { autocomplete: true, maxLength: 30 };

export default hgroup({
  name: 'search',
  subs: [
    hsub('search ai-overview', aiRun(async i => {
      const q = i.options.getString('query', true);
      const { hits, engine } = await s.webSearch(q, { limit: 6 });
      const sources = hits.map((h, n) => `[${n + 1}] ${h.title}\n${h.url}\n${h.snippet}`).join('\n\n');
      const kind = i.options.getString('engine') === 'llama' && llmConfigured('llama') ? 'llama' : 'chat';
      const answer = await ask(
        'You write a short, neutral overview (3-6 sentences) answering the search query using ONLY the numbered sources. Cite sources inline like [1]. If the sources don\'t answer it, say so. No preamble.',
        `Query: ${q}\n\nSources:\n${sources}`, { kind, temperature: 0.3, maxTokens: 500 });
      await i.editReply(card({
        title: `✨ ${trunc(q, 80)}`, color: 0x9b59b6, description: sanitizeReply(answer, 2500),
        fields: [['Sources', hits.map((h, n) => `[${n + 1}] [${trunc(h.title, 60)}](${h.url})`).join('\n')]], footer: `${modelLabel(kind)} · results via ${engine} · AI can be wrong`,
      }));
    }), { autocomplete: aiEngineAutocomplete, tweaks: { ...q200, engine: engineOpt } }),
    hsub('search grokipedia', lookup(async i => {
      const hits = await s.grokipedia(i.options.getString('query', true), i.options.getInteger('limit') ?? 20);
      const pages = chunk(hits, 5).map((group, p) => ({
        container: new ContainerBuilder().setAccentColor(0x111111).addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `### Grokipedia: ${trunc(i.options.getString('query', true), 60)}\n${group.map((h, n) => `**${p * 5 + n + 1}. [${trunc(h.title, 80)}](${h.url})**\n${trunc(h.snippet, 200)}`).join('\n\n')}`)),
      }));
      await sendPages(i, pages);
    }), { tweaks: { ...q200, limit: { min: 1, max: 40 } } }),
    hsub('search images', lookup(async i => {
      const hits = await s.imageSearch(i.options.getString('query', true), { engine: i.options.getString('engine'), safe: s.safeOf(i.options.getString('safesearch')), time: i.options.getString('time') });
      await sendPages(i, hits.map((h, n) => ({
        container: new ContainerBuilder().setAccentColor(BLUE)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### [${trunc(h.title || 'Image', 90)}](${h.source})\n-# ${n + 1} of ${hits.length}${h.width ? ` · ${h.width}×${h.height}` : ''}`))
          .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(h.image))),
      })));
    }), { autocomplete: engineAutocomplete, tweaks: { ...q200, engine: engineOpt, time: { maxLength: 10 } } }),
    hsub('search news', lookup(async i => {
      const hits = await s.newsSearch(i.options.getString('query', true), { engine: i.options.getString('engine'), safe: s.safeOf(i.options.getString('safesearch')), time: i.options.getString('time') });
      await sendPages(i, hits.map((h, n) => {
        const text = `### [${trunc(h.title, 120)}](${h.url})\n${trunc(h.excerpt, 400)}\n-# ${n + 1} of ${hits.length}${h.source ? ` · ${h.source}` : ''}${h.date ? ` · ${when(h.date, 'R')}` : ''}`;
        const c = new ContainerBuilder().setAccentColor(BLUE);
        if (h.image && /^https:\/\//.test(h.image)) c.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text)).setThumbnailAccessory(new ThumbnailBuilder().setURL(h.image)));
        else c.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
        return { container: c };
      }));
    }), { autocomplete: engineAutocomplete, tweaks: { ...q200, engine: engineOpt, time: { maxLength: 10 } } }),
    hsub('search text', lookup(async i => {
      const q = i.options.getString('query', true);
      const r = await s.webSearch(q, { engine: i.options.getString('engine'), safe: s.safeOf(i.options.getString('safesearch')) });
      await i.editReply(listCard(`Results for "${trunc(q, 60)}"`, r.hits.map((h, n) => `**${n + 1}.** [${trunc(h.title, 80)}](${h.url})\n${trunc(h.snippet, 200)}`), { color: BLUE, footer: `via ${r.engine}` }));
    }), { autocomplete: engineAutocomplete, tweaks: { ...q200, engine: engineOpt } }),
  ],
});
