import {
  ApplicationIntegrationType, ChatInputCommandInteraction,
  InteractionContextType, MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import * as db from '../../utils/db';
import { Command } from '../../interfaces/command';
import { cv2Text } from '../../utils/components.js';

const Roles: Command = {
  data: new SlashCommandBuilder()
    .setName('roles')
    .setDescription('Role management commands')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(s => s.setName('self').setDescription('Toggle a self-assignable role')
      .addStringOption(o => o.setName('name').setDescription('Role command name').setRequired(true))),

  async run(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild!;
    const guildId = guild.id;

    if (sub === 'self') {
      const name = interaction.options.getString('name', true);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const rc = await db.getRoleCommandByName(guildId, name);
      if (!rc) { await interaction.editReply(cv2Text(`❌ No self-assignable role named \`${name}\`. Use \`/rolesconfig self-assign list\` to see available roles.`)); return; }
      const member = await guild.members.fetch(interaction.user.id);
      const hasRole = member.roles.cache.has(rc.role_id);
      if (!hasRole && rc.group_name) {
        const groupCmds = (await db.getRoleCommands(guildId)).filter(c => c.group_name === rc.group_name && c.id !== rc.id);
        for (const other of groupCmds) {
          if (member.roles.cache.has(other.role_id)) await member.roles.remove(other.role_id).catch(() => {});
        }
      }
      if (hasRole) {
        await member.roles.remove(rc.role_id).catch(() => {});
        await interaction.editReply(cv2Text(`✅ Removed <@&${rc.role_id}>.`));
      } else {
        await member.roles.add(rc.role_id).catch(() => {});
        await interaction.editReply(cv2Text(`✅ Added <@&${rc.role_id}>.`));
      }
    }
  },
};

export default Roles;
