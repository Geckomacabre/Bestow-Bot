import { ApplicationIntegrationType, ChatInputCommandInteraction, Colors, EmbedBuilder, InteractionContextType, PermissionsBitField, SlashCommandBuilder,
  MessageFlags,
} from 'discord.js';
import { Command } from '../../interfaces/command';

const PERM_NAMES: Record<string, string> = {
  AddReactions: 'Add Reactions', Administrator: 'Administrator', AttachFiles: 'Attach Files',
  BanMembers: 'Ban Members', ChangeNickname: 'Change Nickname', Connect: 'Connect',
  CreateInstantInvite: 'Create Invites', DeafenMembers: 'Deafen Members',
  EmbedLinks: 'Embed Links', KickMembers: 'Kick Members', ManageChannels: 'Manage Channels',
  ManageEmojisAndStickers: 'Manage Emojis', ManageEvents: 'Manage Events',
  ManageGuild: 'Manage Server', ManageMessages: 'Manage Messages',
  ManageNicknames: 'Manage Nicknames', ManageRoles: 'Manage Roles',
  ManageThreads: 'Manage Threads', ManageWebhooks: 'Manage Webhooks',
  MentionEveryone: 'Mention Everyone', ModerateMembers: 'Timeout Members',
  MoveMembers: 'Move Members', MuteMembers: 'Mute Members',
  PrioritySpeaker: 'Priority Speaker', ReadMessageHistory: 'Read History',
  RequestToSpeak: 'Request to Speak', SendMessages: 'Send Messages',
  SendMessagesInThreads: 'Send in Threads', SendTTSMessages: 'Send TTS',
  Speak: 'Speak', Stream: 'Video', UseApplicationCommands: 'Use Slash Commands',
  UseExternalEmojis: 'External Emojis', UseExternalStickers: 'External Stickers',
  UseVAD: 'Use Voice Activity', ViewAuditLog: 'View Audit Log',
  ViewChannel: 'View Channel', ViewGuildInsights: 'View Insights',
};

const Viewperms: Command = {
  data: new SlashCommandBuilder()
    .setName('viewperms')
    .setDescription("View a user's permissions in this server or a specific channel")
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addUserOption(o => o.setName('user').setDescription('User (defaults to you)'))
    .addChannelOption(o => o.setName('channel').setDescription('Check channel-specific permissions')) as any,

  async run(interaction: ChatInputCommandInteraction) {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const channel = interaction.options.getChannel('channel');
    const member = await interaction.guild!.members.fetch(user.id).catch(() => null);
    if (!member) { await interaction.reply({ content: 'Could not find that member.', flags: MessageFlags.Ephemeral }); return; }

    const perms = channel
      ? member.permissionsIn(channel.id)
      : member.permissions;

    const granted = Object.entries(PERM_NAMES)
      .filter(([flag]) => perms.has(flag as any))
      .map(([, name]) => name);

    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle(`${user.username}'s Permissions${channel ? ` in #${(channel as any).name}` : ''}`)
      .setDescription(granted.length ? granted.map(p => `✅ ${p}`).join('\n') : 'No permissions')
      .setThumbnail(user.displayAvatarURL());

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export default Viewperms;
