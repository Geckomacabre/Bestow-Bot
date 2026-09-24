import {
  ApplicationIntegrationType, ChatInputCommandInteraction, InteractionContextType,
  PermissionFlagsBits, SlashCommandBuilder,
} from 'discord.js';
import * as db from '../../utils/db';
import { Command } from '../../interfaces/command';
import { cv2Text, cv2Err } from '../../utils/components.js';
import { sendModCase } from '../../utils/modActions.js';

const Unban: Command = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user by ID')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(o => o.setName('user_id').setDescription('User ID to unban').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason')),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
      await interaction.reply(cv2Err('❌ You need **Ban Members** to use this command.')); return;
    }
    const userId = interaction.options.getString('user_id', true);
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    await interaction.deferReply();
    try { await interaction.guild!.members.unban(userId, reason); }
    catch { await interaction.editReply(cv2Text('❌ Could not unban that user. They may not be banned or the ID is invalid.')); return; }
    let userTag = userId;
    try { const u = await interaction.client.users.fetch(userId); userTag = u.tag; } catch {}
    const modCase = await db.createModCase(guildId, 'unban', userId, userTag, interaction.user.id, interaction.user.tag, reason);
    await sendModCase(interaction, modCase, { tag: userTag, id: userId }, [`**Reason:** ${reason}`]);
  },
};

export default Unban;
