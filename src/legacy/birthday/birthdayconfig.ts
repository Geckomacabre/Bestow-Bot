import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  ContainerBuilder, InteractionContextType, MessageFlags,
  PermissionFlagsBits, SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import * as db from '../../utils/db';
import { cv2Text } from '../../utils/components.js';

const IS_CV2 = MessageFlags.IsComponentsV2;

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_IN_MONTH = [31,29,31,30,31,30,31,31,30,31,30,31];

function ordinal(n: number): string {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

const BirthdayConfig: Command = {
  data: new SlashCommandBuilder()
    .setName('birthdayconfig')
    .setDescription('Configure the birthday system (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(s => s.setName('channel').setDescription('Set the birthday announcement channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel for announcements').setRequired(true)))
    .addSubcommand(s => s.setName('toggle').setDescription('Enable or disable birthday announcements'))
    .addSubcommand(s => s.setName('view').setDescription('View current birthday settings'))
    .addSubcommand(s => s.setName('delete').setDescription("Delete a user's birthday")
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))),

  async run(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const config = await db.getBirthdayConfig(interaction.guildId!);

    if (sub === 'channel') {
      const channel = interaction.options.getChannel('channel', true);
      await db.setBirthdayConfig(interaction.guildId!, { channel_id: channel.id });
      await interaction.reply({ ...cv2Text(`✅ Birthday announcements will be sent to <#${channel.id}>.`), flags: IS_CV2 | MessageFlags.Ephemeral });

    } else if (sub === 'toggle') {
      const newState = !config.enabled;
      await db.setBirthdayConfig(interaction.guildId!, { enabled: newState ? 1 : 0 });
      await interaction.reply({ ...cv2Text(`✅ Birthday announcements are now **${newState ? 'enabled' : 'disabled'}**.`), flags: IS_CV2 | MessageFlags.Ephemeral });

    } else if (sub === 'delete') {
      const user = interaction.options.getUser('user', true);
      await db.removeBirthday(interaction.guildId!, user.id);
      await interaction.reply({ ...cv2Text(`✅ Removed birthday for **${user.username}**.`), flags: IS_CV2 | MessageFlags.Ephemeral });

    } else {
      const container = new ContainerBuilder()
        .setAccentColor(Colors.Gold)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `**🎂 Birthday Config**\n**Status:** ${config.enabled ? '✅ Enabled' : '❌ Disabled'}\n**Channel:** ${config.channel_id ? `<#${config.channel_id}>` : 'Not set'}`
        ));
      await interaction.reply({ flags: IS_CV2 | MessageFlags.Ephemeral, components: [container] });
    }
  },
};

export default BirthdayConfig;
