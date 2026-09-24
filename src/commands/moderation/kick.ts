import {
  ApplicationIntegrationType, ChatInputCommandInteraction, InteractionContextType,
  PermissionFlagsBits, SlashCommandBuilder,
} from 'discord.js';
import * as db from '../../utils/db';
import { Command } from '../../interfaces/command';
import { cv2Text, cv2Err } from '../../utils/components.js';
import { sendModCase } from '../../utils/modActions.js';

const Kick: Command = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName('user').setDescription('Member to kick').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for the kick')),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.KickMembers)) {
      await interaction.reply(cv2Err('❌ You need **Kick Members** to use this command.')); return;
    }
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    await interaction.deferReply();
    const member = await interaction.guild!.members.fetch(user.id).catch(() => null);
    if (!member) { await interaction.editReply(cv2Text('❌ Could not find that member in this server.')); return; }
    if (!member.kickable) { await interaction.editReply(cv2Text('❌ I cannot kick this user.')); return; }
    const cfg = await db.getModConfig(guildId);
    if (cfg.dm_on_punish) {
      await user.send(`You have been **kicked** from **${interaction.guild!.name}**.\nReason: ${reason}`).catch(() => {});
    }
    await member.kick(reason);
    const modCase = await db.createModCase(guildId, 'kick', user.id, user.tag, interaction.user.id, interaction.user.tag, reason);
    await sendModCase(interaction, modCase, user, [`**Reason:** ${reason}`]);
  },
};

export default Kick;
