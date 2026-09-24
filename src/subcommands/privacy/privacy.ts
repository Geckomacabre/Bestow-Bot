import { AttachmentBuilder, MessageFlags } from 'discord.js';
import type { Sub } from '../../framework/group.js';
import { askUser } from '../../framework/confirm.js';
import { card } from '../../lookups/card.js';
import { DeleteRefused, POLICY, deleteData, exportData, summarize } from '../../privacy/index.js';

const bullets = (xs: readonly string[]) => xs.map(x => `• ${x}`).join('\n');

export const privacySubs: Sub[] = [
  {
    name: 'policy', description: 'What this bot stores about you, and what it never does',
    run: async i => {
      await i.reply({
        ...card({
          title: '🔒 Privacy', color: 0x57f287,
          description: `**What it stores**\n${bullets(POLICY.stores)}\n\n**What it never stores**\n${bullets(POLICY.neverStores)}\n\n**Sharing**\n${bullets(POLICY.sharing)}`,
          footer: 'See exactly what\'s stored with /privacy data · download it with /privacy export · erase it with /privacy delete',
        }),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    },
  },
  {
    name: 'data', description: 'See what the bot currently has stored about you',
    run: async i => {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const rows = await summarize(i.user.id);
      const line = (s: (typeof rows)[number]) => `• **${s.label}** — ${s.rows.toLocaleString('en-US')} row${s.rows === 1 ? '' : 's'}${s.policy === 'keep' ? ' 🏛️' : s.policy === 'anonymize' ? ' 🎭' : ''}`;
      await i.editReply(card({
        title: '📂 What I have about you', color: 0x5865f2,
        description: rows.length ? rows.map(line).join('\n') : '*Nothing — you haven\'t used anything that stores data yet.*',
        footer: '🏛️ = a server\'s own record (only its staff can remove it) · 🎭 = stays with the server but is detached from you when you delete',
      }));
    },
  },
  {
    name: 'export', description: 'Download everything the bot has stored about you (private)',
    run: async i => {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const r = await exportData(i.user.id);
      await i.editReply({ content: `📦 Here's your data: **${r.rows.toLocaleString('en-US')}** rows across **${r.tables}** categories. Only you can see this message.`, files: [new AttachmentBuilder(r.data, { name: r.name })] });
    },
  },
  {
    name: 'delete', description: 'Permanently erase your data from this bot',
    run: async i => {
      // Private (ephemeral) end to end. Plain-text replies only: a message that starts as plain text can't be edited into a Components-V2 one.
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const rows = await summarize(i.user.id);
      const deletable = rows.filter(r => r.policy !== 'keep');
      if (!deletable.length) {
        await i.editReply({ content: 'There\'s nothing of yours to delete.', components: [] });
        return;
      }
      const ok = await askUser(i, {
        userId: i.user.id, acceptLabel: 'Delete my data', declineLabel: 'Cancel', timeoutMs: 60_000,
        content: `⚠️ **Erase your data?** This permanently deletes your balance, levels, cards, reminders and every other setting stored under your ID (${deletable.reduce((s, r) => s + r.rows, 0).toLocaleString('en-US')} rows). **It can't be undone.**\nServer moderation records stay with each server. Run \`/privacy data\` first if you want to see the list.`,
      });
      if (!ok) { await i.editReply({ content: 'Cancelled — nothing was deleted.', components: [] }); return; }
      try {
        const r = await deleteData(i.user.id);
        await i.editReply({
          content: `🗑️ Done. Deleted **${r.deleted.toLocaleString('en-US')}** rows${r.anonymized ? `, detached you from **${r.anonymized}** server-owned item${r.anonymized === 1 ? '' : 's'}` : ''}${r.removedFile ? ' and your wallet background image' : ''}.`
            + (r.kept.length ? `\nKept for the servers that created them: ${r.kept.map(k => `${k.label} (${k.rows})`).join(', ')}. Ask that server's staff to remove those.` : ''),
          components: [],
        });
      } catch (e) {
        if (e instanceof DeleteRefused) { await i.editReply({ content: `❌ ${e.message}`, components: [] }); return; }
        console.error('[privacy delete]', e);
        await i.editReply({ content: '❌ Something went wrong while deleting. Nothing further was changed — please try again, and tell the bot owner if it keeps happening.', components: [] }).catch(() => {});
      }
    },
  },
];
