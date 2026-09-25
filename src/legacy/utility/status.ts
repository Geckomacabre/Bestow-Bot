import {
  ActivityType, ApplicationIntegrationType, ChatInputCommandInteraction,
  InteractionContextType, MessageFlags, SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { getBotConfig, setBotConfig, deleteBotConfig } from '../../utils/db';
import Config from '../../config';
import { cv2Err, cv2Text } from '../../utils/components.js';

const ACTIVITY_TYPES: Record<string, number> = {
  custom:    ActivityType.Custom,
  playing:   ActivityType.Playing,
  watching:  ActivityType.Watching,
  listening: ActivityType.Listening,
  competing: ActivityType.Competing,
};

const TYPE_LABELS: Record<number, string> = {
  [ActivityType.Custom]:    'Custom',
  [ActivityType.Playing]:   'Playing',
  [ActivityType.Watching]:  'Watching',
  [ActivityType.Listening]: 'Listening to',
  [ActivityType.Competing]: 'Competing in',
};

function isOwner(userId: string): boolean {
  const ids = Config.OWNER_IDS?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
  return ids.includes(userId);
}

const Status: Command = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Manage the bot\'s status message (bot owner only)')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(s => s
      .setName('set')
      .setDescription('Set the bot\'s status message')
      .addStringOption(o => o.setName('message').setDescription('Status text to display').setRequired(true))
      .addStringOption(o => o
        .setName('type')
        .setDescription('Activity type (default: custom)')
        .addChoices(
          { name: 'Custom',       value: 'custom' },
          { name: 'Playing',      value: 'playing' },
          { name: 'Watching',     value: 'watching' },
          { name: 'Listening to', value: 'listening' },
          { name: 'Competing in', value: 'competing' },
        )))
    .addSubcommand(s => s
      .setName('clear')
      .setDescription('Remove the bot\'s status message'))
    .addSubcommand(s => s
      .setName('view')
      .setDescription('View the current bot status')) as any,

  async run(interaction: ChatInputCommandInteraction) {
    if (!isOwner(interaction.user.id)) {
      await interaction.reply({ ...cv2Err('❌ Only bot owners can manage the bot status.'), flags: MessageFlags.Ephemeral });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const text = interaction.options.getString('message', true);
      const typeName = interaction.options.getString('type') ?? 'custom';
      const type = ACTIVITY_TYPES[typeName] ?? ActivityType.Custom;

      await setBotConfig('presence', JSON.stringify({ text, type }));
      interaction.client.user?.setPresence({ activities: [{ name: text, type }], status: 'online' });

      const prefix = TYPE_LABELS[type] ?? '';
      await interaction.reply({
        ...cv2Text(`✅ Bot status set to **${prefix ? prefix + ' ' : ''}${text}**.`),
        flags: MessageFlags.Ephemeral,
      });

    } else if (sub === 'clear') {
      await deleteBotConfig('presence');
      interaction.client.user?.setPresence({ activities: [], status: 'online' });
      await interaction.reply({ ...cv2Text('✅ Bot status cleared.'), flags: MessageFlags.Ephemeral });

    } else {
      const saved = await getBotConfig('presence');
      if (!saved) {
        await interaction.reply({ ...cv2Text('No status is currently set.'), flags: MessageFlags.Ephemeral });
        return;
      }
      const { text, type } = JSON.parse(saved) as { text: string; type: number };
      const prefix = TYPE_LABELS[type] ?? '';
      await interaction.reply({
        ...cv2Text(`**Current status:** ${prefix ? prefix + ' ' : ''}${text}`),
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

export default Status;
