import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors, ContainerBuilder,
  InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import * as db from '../../utils/db';
import { Command } from '../../interfaces/command';
import { cv2Text, cv2Err, IS_CV2 } from '../../utils/components.js';

const Warnings: Command = {
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('View and manage user warnings')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand(s => s.setName('list').setDescription('List warnings for a user')
      .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(true)))
    .addSubcommand(s => s.setName('clear').setDescription('Clear all warnings for a user')
      .addUserOption(o => o.setName('user').setDescription('User to clear').setRequired(true)))
    .addSubcommand(s => s.setName('delete').setDescription('Delete a specific warning by ID')
      .addIntegerOption(o => o.setName('id').setDescription('Warning ID').setRequired(true))),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    const sub = interaction.options.getSubcommand();
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      await interaction.reply(cv2Err('❌ You need **Moderate Members** to manage warnings.')); return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (sub === 'clear') {
      const user = interaction.options.getUser('user', true);
      const count = await db.clearWarnings(guildId, user.id);
      await interaction.editReply(cv2Text(`✅ Cleared **${count}** warning(s) for ${user.tag}.`));
    } else if (sub === 'delete') {
      const id = interaction.options.getInteger('id', true);
      const deleted = await db.deleteWarning(id, guildId);
      await interaction.editReply(cv2Text(deleted ? `✅ Warning #${id} deleted.` : `❌ Warning #${id} not found.`));
    } else {
      const user = interaction.options.getUser('user', true);
      const warnings = await db.getWarnings(guildId, user.id);
      if (!warnings.length) { await interaction.editReply(cv2Text(`✅ **${user.tag}** has no warnings.`)); return; }
      const lines = warnings.slice(0, 25).map(w =>
        `**#${w.id}** — <t:${Math.floor(w.created_at / 1000)}:d> by <@${w.mod_id}>\n${w.reason}`
      );
      const container = new ContainerBuilder().setAccentColor(Colors.Yellow)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `**Warnings for ${user.tag}** (${warnings.length} total)\n\n${lines.join('\n\n')}`
        ));
      await interaction.editReply({ flags: IS_CV2, components: [container] });
    }
  },
};

export default Warnings;
