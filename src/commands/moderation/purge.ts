import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Collection, InteractionContextType,
  Message, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, TextChannel,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { cv2Text, cv2Err } from '../../utils/components.js';

const Purge: Command = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk delete messages with optional filters')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName('amount').setDescription('Number of messages to scan (max 200)').setRequired(true).setMinValue(1).setMaxValue(200))
    .addUserOption(o => o.setName('user').setDescription('Only delete messages from this user'))
    .addStringOption(o => o.setName('keyword').setDescription('Only delete messages containing this text'))
    .addBooleanOption(o => o.setName('bots').setDescription('Only delete bot messages'))
    .addBooleanOption(o => o.setName('attachments').setDescription('Only delete messages with attachments'))
    .addBooleanOption(o => o.setName('embeds').setDescription('Only delete messages with embeds')),

  async run(interaction: ChatInputCommandInteraction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply(cv2Err('❌ You need **Manage Messages** to use this command.')); return;
    }
    const amount = interaction.options.getInteger('amount', true);
    const filterUser = interaction.options.getUser('user');
    const keyword = interaction.options.getString('keyword')?.toLowerCase();
    const botsOnly = interaction.options.getBoolean('bots') ?? false;
    const attachmentsOnly = interaction.options.getBoolean('attachments') ?? false;
    const embedsOnly = interaction.options.getBoolean('embeds') ?? false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = interaction.channel as TextChannel;
    const fetched = await channel.messages.fetch({ limit: amount });
    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    let toDelete: Collection<string, Message> = fetched.filter(m => m.createdTimestamp > twoWeeksAgo);
    if (filterUser) toDelete = toDelete.filter(m => m.author.id === filterUser.id);
    if (keyword) toDelete = toDelete.filter(m => m.content.toLowerCase().includes(keyword));
    if (botsOnly) toDelete = toDelete.filter(m => m.author.bot);
    if (attachmentsOnly) toDelete = toDelete.filter(m => m.attachments.size > 0);
    if (embedsOnly) toDelete = toDelete.filter(m => m.embeds.length > 0);
    if (!toDelete.size) { await interaction.editReply(cv2Text('No messages matched your filters (or they are older than 14 days).')); return; }
    const deleted = await channel.bulkDelete(toDelete, true);
    await interaction.editReply(cv2Text(`✅ Deleted **${deleted.size}** message${deleted.size === 1 ? '' : 's'}.`));
  },
};

export default Purge;
