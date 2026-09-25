import {
  ActionRowBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, type AutocompleteInteraction, type ChatInputCommandInteraction,
} from 'discord.js';
import { hgroup, hsub } from '../../framework/heist.js';
import { onComponent } from '../../framework/router.js';
import { listCard, trunc } from '../../lookups/card.js';
import { cv2Box, cv2Err } from '../../utils/components.js';
import * as t from '../../tags/store.js';

const GREEN = 0x57f287;
const priv = { flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral } as const;

async function safely(i: ChatInputCommandInteraction, fn: () => Promise<unknown>) {
  try { await fn(); } catch (e) {
    if (e instanceof t.TagError) { await i.reply({ ...cv2Err(`❌ ${e.message}`) }); return; }
    throw e;
  }
}

async function tagAutocomplete(i: AutocompleteInteraction) {
  const q = String(i.options.getFocused()).toLowerCase();
  const tags = await t.listTags(i.user.id);
  await i.respond(tags.filter(x => x.name.includes(q)).slice(0, 25).map(x => ({ name: `${x.name} — ${trunc(x.content.replace(/\s+/g, ' '), 60)}`.slice(0, 100), value: x.name })));
}

const tagOpt = { tag: { autocomplete: true, maxLength: 32 } };

const editModal = (name: string, content: string) => new ModalBuilder().setCustomId(`tags:edit:${name}`).setTitle(`Edit tag: ${name}`.slice(0, 45))
  .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder().setCustomId('text').setLabel('Text').setStyle(TextInputStyle.Paragraph).setMaxLength(t.MAX_TEXT).setRequired(true).setValue(content.slice(0, t.MAX_TEXT))));

onComponent('tags:', async i => {
  if (!i.isModalSubmit() || !i.customId.startsWith('tags:edit:')) return;
  const name = i.customId.slice('tags:edit:'.length);
  try {
    const ok = await t.editTag(i.user.id, name, i.fields.getTextInputValue('text'));
    await i.reply({ ...(ok ? cv2Box(`✅ Tag \`${name}\` updated.`, GREEN) : cv2Err(`❌ You don't have a tag called \`${name}\`.`)), flags: priv.flags });
  } catch (e) {
    if (e instanceof t.TagError) { await i.reply({ ...cv2Err(`❌ ${e.message}`) }); return; }
    throw e;
  }
});

export default hgroup({
  name: 'tags',
  subs: [
    hsub('tags create', i => safely(i, async () => {
      const tag = await t.createTag(i.user.id, i.options.getString('tag', true), i.options.getString('text', true));
      await i.reply({ ...cv2Box(`✅ Created tag \`${tag.name}\`. Send it anywhere with \`/tags send tag:${tag.name}\`.`, GREEN), flags: priv.flags });
    }), { tweaks: { tag: { maxLength: 32 }, text: { maxLength: t.MAX_TEXT } } }),
    hsub('tags delete', i => safely(i, async () => {
      const name = i.options.getString('tag', true);
      const ok = await t.deleteTag(i.user.id, name);
      await i.reply({ ...(ok ? cv2Box(`🗑️ Deleted tag \`${t.normName(name)}\`.`, GREEN) : cv2Err(`❌ You don't have a tag called \`${t.normName(name)}\`.`)), flags: priv.flags });
    }), { autocomplete: tagAutocomplete, tweaks: tagOpt }),
    hsub('tags edit', i => safely(i, async () => {
      const tag = await t.getTag(i.user.id, i.options.getString('tag', true));
      if (!tag) throw new t.TagError('You don\'t have a tag with that name.');
      await i.showModal(editModal(tag.name, tag.content));
    }), { autocomplete: tagAutocomplete, tweaks: tagOpt }),
    hsub('tags export', i => safely(i, async () => {
      const { code, count } = await t.exportTags(i.user.id);
      await i.reply({ ...cv2Box(`📦 **${count}** tag${count === 1 ? '' : 's'} exported.\nSync code: \`${code}\`\nUse it once with \`/tags import\` within 24 hours. Anyone with the code can import your tags, so only share it on purpose.`, GREEN), flags: priv.flags });
    })),
    hsub('tags import', i => safely(i, async () => {
      const r = await t.importTags(i.user.id, i.options.getString('hash', true));
      await i.reply({ ...cv2Box(`📥 Imported **${r.added}** tag${r.added === 1 ? '' : 's'}.${r.skipped.length ? `\nSkipped (you already have them, or you're at the limit): ${r.skipped.map(s => `\`${s}\``).join(', ')}` : ''}`, GREEN), flags: priv.flags });
    }), { tweaks: { hash: { maxLength: 40 } } }),
    hsub('tags list', async i => {
      const tags = await t.listTags(i.user.id);
      await i.reply({ ...listCard(`🏷️ Your tags (${tags.length}/${t.MAX_TAGS})`, tags.map(x => `• \`${x.name}\` — ${trunc(x.content.replace(/\s+/g, ' '), 70)}${x.uses ? ` · used ${x.uses}×` : ''}`), { color: GREEN }), flags: priv.flags });
    }),
    hsub('tags send', i => safely(i, async () => {
      const tag = await t.useTag(i.user.id, i.options.getString('tag', true));
      if (!tag) throw new t.TagError('You don\'t have a tag with that name. See yours with /tags list.');
      await i.reply({ content: tag.content, allowedMentions: { parse: [] } });
    }), { autocomplete: tagAutocomplete, tweaks: tagOpt }),
  ],
});
