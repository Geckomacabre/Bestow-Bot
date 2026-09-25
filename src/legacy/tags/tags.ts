import {
  ApplicationIntegrationType, ChatInputCommandInteraction, EmbedBuilder,
  InteractionContextType, MessageFlags, SlashCommandBuilder, Colors,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import * as db from '../../utils/db';

const Tags: Command = {
  data: new SlashCommandBuilder()
    .setName('tag')
    .setDescription('Community tags — store and retrieve text snippets')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(s => s.setName('get').setDescription('Show a tag')
      .addStringOption(o => o.setName('name').setDescription('Tag name').setRequired(true)))
    .addSubcommand(s => s.setName('create').setDescription('Create a new tag')
      .addStringOption(o => o.setName('name').setDescription('Tag name (max 32 chars)').setRequired(true))
      .addStringOption(o => o.setName('content').setDescription('Tag content').setRequired(true)))
    .addSubcommand(s => s.setName('edit').setDescription('Edit your tag')
      .addStringOption(o => o.setName('name').setDescription('Tag name').setRequired(true))
      .addStringOption(o => o.setName('content').setDescription('New content').setRequired(true)))
    .addSubcommand(s => s.setName('delete').setDescription('Delete your tag (mods can delete any tag)')
      .addStringOption(o => o.setName('name').setDescription('Tag name').setRequired(true)))
    .addSubcommand(s => s.setName('info').setDescription('Show info about a tag')
      .addStringOption(o => o.setName('name').setDescription('Tag name').setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('List all tags in this server')) as any,

  async run(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId!;

    if (sub === 'get') {
      const name = interaction.options.getString('name', true).toLowerCase();
      const tag = await db.getTag(guildId, name);
      if (!tag) { await interaction.reply({ content: `❌ Tag \`${name}\` not found.`, flags: MessageFlags.Ephemeral }); return; }
      await db.incrementTagUses(guildId, name);
      await interaction.reply(tag.content);
    }

    else if (sub === 'create') {
      const name = interaction.options.getString('name', true).toLowerCase().slice(0, 32);
      const content = interaction.options.getString('content', true);
      const tag = await db.createTag(guildId, name, content, interaction.user.id);
      if (!tag) { await interaction.reply({ content: `❌ A tag named \`${name}\` already exists.`, flags: MessageFlags.Ephemeral }); return; }
      await interaction.reply({ content: `✅ Tag \`${name}\` created.`, flags: MessageFlags.Ephemeral });
    }

    else if (sub === 'edit') {
      const name = interaction.options.getString('name', true).toLowerCase();
      const content = interaction.options.getString('content', true);
      const ok = await db.editTag(guildId, name, content, interaction.user.id);
      if (!ok) { await interaction.reply({ content: `❌ Tag not found or you don't own it.`, flags: MessageFlags.Ephemeral }); return; }
      await interaction.reply({ content: `✅ Tag \`${name}\` updated.`, flags: MessageFlags.Ephemeral });
    }

    else if (sub === 'delete') {
      const name = interaction.options.getString('name', true).toLowerCase();
      const member = interaction.member as any;
      const isMod = member?.permissions?.has?.('ManageGuild') ?? false;
      const ok = await db.deleteTag(guildId, name, interaction.user.id, isMod);
      if (!ok) { await interaction.reply({ content: `❌ Tag not found or you don't have permission to delete it.`, flags: MessageFlags.Ephemeral }); return; }
      await interaction.reply({ content: `🗑️ Tag \`${name}\` deleted.`, flags: MessageFlags.Ephemeral });
    }

    else if (sub === 'info') {
      const name = interaction.options.getString('name', true).toLowerCase();
      const tag = await db.getTag(guildId, name);
      if (!tag) { await interaction.reply({ content: `❌ Tag \`${name}\` not found.`, flags: MessageFlags.Ephemeral }); return; }
      const embed = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle(`Tag: ${tag.name}`)
        .addFields(
          { name: 'Owner', value: `<@${tag.owner_id}>`, inline: true },
          { name: 'Uses', value: String(tag.uses), inline: true },
          { name: 'Created', value: `<t:${tag.created_at}:R>`, inline: true },
        )
        .setDescription(tag.content.slice(0, 300) + (tag.content.length > 300 ? '…' : ''));
      await interaction.reply({ embeds: [embed] });
    }

    else if (sub === 'list') {
      const tags = await db.listTags(guildId);
      if (!tags.length) { await interaction.reply({ content: 'No tags have been created yet.', flags: MessageFlags.Ephemeral }); return; }
      const chunks: string[] = [];
      let chunk = '';
      for (const t of tags) {
        const entry = `\`${t.name}\` `;
        if (chunk.length + entry.length > 1900) { chunks.push(chunk); chunk = ''; }
        chunk += entry;
      }
      if (chunk) chunks.push(chunk);
      const embed = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle(`Tags (${tags.length})`)
        .setDescription(chunks[0] ?? 'None');
      await interaction.reply({ embeds: [embed] });
    }
  },
};

export default Tags;
