import {
  ApplicationIntegrationType, ChatInputCommandInteraction, InteractionContextType,
  PermissionFlagsBits, SlashCommandBuilder,
} from 'discord.js';
import * as db from '../../utils/db';
import { Command } from '../../interfaces/command';
import { cv2Text, cv2Err } from '../../utils/components.js';
import { sendModCase } from '../../utils/modActions.js';

const Untimeout: Command = {
  data: new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Remove a timeout from a member')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason')),

  async run(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      await interaction.reply(cv2Err('❌ You need **Moderate Members** to use this command.')); return;
    }
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    await interaction.deferReply();
    const member = await interaction.guild!.members.fetch(user.id).catch(() => null);
    if (!member) { await interaction.editReply(cv2Text('❌ Could not find that member.')); return; }
    await member.timeout(null, reason);
    const modCase = await db.createModCase(guildId, 'removetimeout', user.id, user.tag, interaction.user.id, interaction.user.tag, reason);
    await sendModCase(interaction, modCase, user, [`**Reason:** ${reason}`]);
  },
};

export default Untimeout;
