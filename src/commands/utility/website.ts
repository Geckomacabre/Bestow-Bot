import { AttachmentBuilder } from 'discord.js';
import { hgroup, hsub } from '../../framework/heist.js';
import { MediaError, mediaHandler, uploadLimit } from '../../framework/media.js';
import { card, trunc } from '../../lookups/card.js';
import { lookup, LookupError } from '../../lookups/handler.js';
import * as web from '../../lookups/website.js';

const url500 = { url: { maxLength: 500 } };

export default hgroup({
  name: 'website',
  subs: [
    hsub('website download', lookup(async i => {
      const r = await web.downloadSite(i.options.getString('url', true), { maxBytes: Math.min(20 * 1024 * 1024, Math.floor(uploadLimit(i) * 0.9)) });
      if (r.zip.length > uploadLimit(i)) throw new LookupError('That site is too big to send here.');
      await i.editReply({ ...card({ title: `📦 ${trunc(new URL(r.url).hostname, 90)}`, url: r.url, color: 0x5865f2, description: `**${r.files}** files · ${(r.bytes / 1048576).toFixed(2)} MB\nOpen \`index.html\` from the ZIP. Pages that build themselves with JavaScript may need an internet connection to look right.` }), files: [new AttachmentBuilder(r.zip, { name: 'website.zip' })] });
    }), { tweaks: url500 }),
    hsub('website screenshot', lookup(async i => {
      const r = await web.screenshot(i.options.getString('url', true), { delay: web.parseDelay(i.options.getString('delay')), click: !!i.options.getBoolean('click') });
      await i.editReply(card({ title: trunc(new URL(r.url).hostname, 100), url: r.url, color: 0x5865f2, image: 'attachment://site.png', files: [new AttachmentBuilder(r.png, { name: 'site.png' })], footer: `Screenshot by ${r.engine} — I don't control what the page shows.` }));
    }), { tweaks: { ...url500, delay: { maxLength: 10 } } }),
    hsub('website scroll', mediaHandler(async i => {
      let r;
      try { r = await web.scrollVideo(i.options.getString('url', true), i.options.getString('length', true), i.options.getString('animation', true)); }
      catch (e) { if (e instanceof LookupError) throw new MediaError(e.message); throw e; }
      if (r.mp4.length > uploadLimit(i)) throw new MediaError('The video came out too big to send here — try `short`.');
      await i.editReply({ content: `🖱️ <${r.url}>`, files: [new AttachmentBuilder(r.mp4, { name: 'scroll.mp4' })] });
    }), { tweaks: url500 }),
  ],
});
