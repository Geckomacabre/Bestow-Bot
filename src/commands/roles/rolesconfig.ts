import {
  ApplicationIntegrationType, ChannelType, ChatInputCommandInteraction, Colors,
  ContainerBuilder, InteractionContextType, MessageFlags, PermissionFlagsBits,
  SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import * as db from '../../utils/db';
import { Command } from '../../interfaces/command';
import { cv2Text } from '../../utils/components.js';

const IS_CV2 = MessageFlags.IsComponentsV2;

function parseMessageLink(link: string): { channelId: string; messageId: string } | null {
  const match = link.match(/(?:channels\/\d+\/|^)(\d+)\/(\d+)$/);
  if (!match) return null;
  return { channelId: match[1], messageId: match[2] };
}

const RolesConfig: Command = {
  data: new SlashCommandBuilder()
    .setName('rolesconfig')
    .setDescription('Role management configuration (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(s => s.setName('bulk').setDescription('Assign or remove a role from many members at once')
      .addStringOption(o => o.setName('action').setDescription('assign or remove').setRequired(true)
        .addChoices({ name: 'assign', value: 'assign' }, { name: 'remove', value: 'remove' }))
      .addRoleOption(o => o.setName('role').setDescription('Role to assign/remove').setRequired(true))
      .addStringOption(o => o.setName('filter').setDescription('Which members').setRequired(true)
        .addChoices(
          { name: 'All members', value: 'all' },
          { name: 'Has specific role', value: 'has_role' },
          { name: 'Missing specific role', value: 'missing_role' },
          { name: 'Bots only', value: 'bots' },
          { name: 'Humans only', value: 'humans' },
        ))
      .addRoleOption(o => o.setName('filter_role').setDescription('Role used for has_role/missing_role filter')))
    .addSubcommandGroup(g => g.setName('self-assign').setDescription('Manage self-assignable role definitions')
      .addSubcommand(s => s.setName('add').setDescription('Register a self-assignable role')
        .addStringOption(o => o.setName('name').setDescription('Name users type with /roles self').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('Role to assign').setRequired(true))
        .addStringOption(o => o.setName('group').setDescription('Group name (only one per group can be held)')))
      .addSubcommand(s => s.setName('remove').setDescription('Remove a self-assignable role by ID')
        .addIntegerOption(o => o.setName('id').setDescription('Role command ID').setRequired(true)))
      .addSubcommand(s => s.setName('list').setDescription('List all self-assignable roles')))
    .addSubcommandGroup(g => g.setName('reaction').setDescription('Roles assigned via emoji reactions')
      .addSubcommand(s => s.setName('add').setDescription('Add a reaction role to a message')
        .addStringOption(o => o.setName('message_link').setDescription('Message link or channel_id/message_id').setRequired(true))
        .addStringOption(o => o.setName('emoji').setDescription('Emoji to react with').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('Role to assign').setRequired(true)))
      .addSubcommand(s => s.setName('remove').setDescription('Remove a reaction role by ID')
        .addIntegerOption(o => o.setName('id').setDescription('ID from /rolesconfig reaction list').setRequired(true)))
      .addSubcommand(s => s.setName('clear').setDescription('Remove all reaction roles from a message')
        .addStringOption(o => o.setName('message_link').setDescription('Message link or channel_id/message_id').setRequired(true)))
      .addSubcommand(s => s.setName('list').setDescription('List all reaction roles in this server'))) as any,

  async run(interaction: ChatInputCommandInteraction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild!;
    const guildId = guild.id;

    // ── /rolesconfig bulk ─────────────────────────────────────────────────────
    if (sub === 'bulk' && !group) {
      const action = interaction.options.getString('action', true);
      const role = interaction.options.getRole('role', true);
      const filter = interaction.options.getString('filter', true);
      const filterRole = interaction.options.getRole('filter_role');
      await interaction.deferReply();
      await interaction.editReply(cv2Text('⏳ Fetching members...'));
      let members = await guild.members.fetch();
      switch (filter) {
        case 'has_role':
          if (!filterRole) { await interaction.editReply(cv2Text('❌ Provide a filter_role for has_role filter.')); return; }
          members = members.filter(m => m.roles.cache.has(filterRole.id)); break;
        case 'missing_role':
          if (!filterRole) { await interaction.editReply(cv2Text('❌ Provide a filter_role for missing_role filter.')); return; }
          members = members.filter(m => !m.roles.cache.has(filterRole.id)); break;
        case 'bots': members = members.filter(m => m.user.bot); break;
        case 'humans': members = members.filter(m => !m.user.bot); break;
      }
      await interaction.editReply(cv2Text(`⏳ Processing **${members.size}** members...`));
      let count = 0;
      for (const member of [...members.values()]) {
        try {
          if (action === 'assign') await member.roles.add(role.id);
          else await member.roles.remove(role.id);
          count++;
        } catch {}
        if (count % 10 === 0) await new Promise(r => setTimeout(r, 1000));
      }
      await interaction.editReply(cv2Text(`✅ ${action === 'assign' ? 'Assigned' : 'Removed'} <@&${role.id}> ${action === 'assign' ? 'to' : 'from'} **${count}** member(s).`));
      return;
    }

    // ── /rolesconfig self-assign ──────────────────────────────────────────────
    if (group === 'self-assign') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (sub === 'add') {
        const name = interaction.options.getString('name', true);
        const role = interaction.options.getRole('role', true);
        const grp = interaction.options.getString('group');
        const rc = await db.addRoleCommand(guildId, name, role.id, grp);
        await interaction.editReply(cv2Text(`✅ Role command **${name}** → <@&${role.id}> created (ID: ${rc.id}).`));
      } else if (sub === 'remove') {
        const id = interaction.options.getInteger('id', true);
        const ok = await db.removeRoleCommand(id, guildId);
        await interaction.editReply(cv2Text(ok ? `✅ Role command #${id} removed.` : `❌ Role command #${id} not found.`));
      } else {
        const cmds = await db.getRoleCommands(guildId);
        if (!cmds.length) { await interaction.editReply(cv2Text('No self-assignable roles configured.')); return; }
        const container = new ContainerBuilder().setAccentColor(Colors.Blurple)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `**Self-Assignable Roles**\n\n${cmds.map(c => `**#${c.id}** \`${c.name}\` → <@&${c.role_id}>${c.group_name ? ` [${c.group_name}]` : ''}`).join('\n')}`
          ));
        await interaction.editReply({ flags: IS_CV2, components: [container] });
      }
      return;
    }

    // ── /rolesconfig reaction ─────────────────────────────────────────────────
    if (group === 'reaction') {
      if (sub === 'add') {
        const link = interaction.options.getString('message_link', true);
        const emojiStr = interaction.options.getString('emoji', true).trim();
        const role = interaction.options.getRole('role', true);
        const parsed = parseMessageLink(link);
        if (!parsed) { await interaction.reply({ ...cv2Text('❌ Invalid message link. Copy it via "Copy Message Link" in Discord.'), flags: IS_CV2 | MessageFlags.Ephemeral }); return; }
        const ch = guild.channels.cache.get(parsed.channelId) as any;
        if (!ch?.isTextBased()) { await interaction.reply({ ...cv2Text('❌ Channel not found.'), flags: IS_CV2 | MessageFlags.Ephemeral }); return; }
        const message = await ch.messages.fetch(parsed.messageId).catch(() => null);
        if (!message) { await interaction.reply({ ...cv2Text('❌ Message not found.'), flags: IS_CV2 | MessageFlags.Ephemeral }); return; }
        await message.react(emojiStr).catch(() => {});
        await db.addReactionRole(guildId, parsed.channelId, parsed.messageId, emojiStr, role.id);
        await interaction.reply({ ...cv2Text(`✅ Reaction role added: ${emojiStr} → <@&${role.id}>`), flags: IS_CV2 | MessageFlags.Ephemeral });
      } else if (sub === 'remove') {
        const id = interaction.options.getInteger('id', true);
        const removed = await db.removeReactionRole(id, guildId);
        await interaction.reply({ ...cv2Text(removed ? '✅ Reaction role removed.' : '❌ No reaction role found with that ID.'), flags: IS_CV2 | MessageFlags.Ephemeral });
      } else if (sub === 'clear') {
        const link = interaction.options.getString('message_link', true);
        const parsed = parseMessageLink(link);
        if (!parsed) { await interaction.reply({ ...cv2Text('❌ Invalid message link.'), flags: IS_CV2 | MessageFlags.Ephemeral }); return; }
        await db.clearReactionRolesForMessage(guildId, parsed.messageId);
        await interaction.reply({ ...cv2Text('✅ All reaction roles cleared for that message.'), flags: IS_CV2 | MessageFlags.Ephemeral });
      } else {
        const all = await db.getReactionRoles(guildId);
        if (!all.length) { await interaction.reply({ ...cv2Text('No reaction roles configured.'), flags: IS_CV2 | MessageFlags.Ephemeral }); return; }
        const container = new ContainerBuilder().setAccentColor(Colors.Blurple)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `**Reaction Roles**\n\n${all.map(r => `**ID ${r.id}** — ${r.emoji} → <@&${r.role_id}> on [message](https://discord.com/channels/${guildId}/${r.channel_id}/${r.message_id})`).join('\n')}`
          ));
        await interaction.reply({ flags: IS_CV2 | MessageFlags.Ephemeral, components: [container] });
      }
    }
  },
};

export default RolesConfig;
