import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors, EmbedBuilder,
  InteractionContextType, SlashCommandBuilder,
  MessageFlags,
} from 'discord.js';
import * as db from '../../utils/db';
import { Command } from '../../interfaces/command';

function parseDuration(s: string): number | null {
  const re = /^(\d+)(s|m|h|d|w)$/i;
  const m = re.exec(s.trim());
  if (!m) return null;
  const n = parseInt(m[1]);
  const units: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  return n * (units[m[2].toLowerCase()] ?? 0) || null;
}

const Reminder: Command = {
  data: new SlashCommandBuilder()
    .setName('reminder')
    .setDescription('Set and manage reminders')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM])
    .addSubcommand(sub => sub
      .setName('set')
      .setDescription('Set a reminder')
      .addStringOption(o => o.setName('time').setDescription('When to remind you (e.g. 10m, 2h, 1d)').setRequired(true))
      .addStringOption(o => o.setName('message').setDescription('What to remind you about').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List your active reminders')
    )
    .addSubcommand(sub => sub
      .setName('delete')
      .setDescription('Delete a reminder')
      .addIntegerOption(o => o.setName('id').setDescription('Reminder ID').setRequired(true))
    ) as any,

  async run(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (sub === 'set') {
      const timeStr = interaction.options.getString('time', true);
      const message = interaction.options.getString('message', true);
      const ms = parseDuration(timeStr);
      if (!ms) { await interaction.editReply('Invalid time format. Use e.g. `10m`, `2h`, `1d`.'); return; }
      const firesAt = Date.now() + ms;
      const reminder = await db.createReminder(interaction.user.id, interaction.channelId, interaction.guildId, message, firesAt);
      await interaction.editReply(`✅ Reminder #${reminder.id} set! I'll remind you <t:${Math.floor(firesAt / 1000)}:R>.\n> ${message}`);

    } else if (sub === 'list') {
      const reminders = await db.getReminders(interaction.user.id);
      if (!reminders.length) { await interaction.editReply('You have no active reminders.'); return; }
      const embed = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle('Your Reminders')
        .setDescription(reminders.map(r => `**#${r.id}** — <t:${Math.floor(r.fires_at / 1000)}:R>\n> ${r.message}`).join('\n\n'));
      await interaction.editReply({ embeds: [embed] });

    } else {
      const id = interaction.options.getInteger('id', true);
      const ok = await db.deleteReminder(id, interaction.user.id);
      await interaction.editReply(ok ? `✅ Reminder #${id} deleted.` : `❌ Reminder #${id} not found.`);
    }
  },
};

export default Reminder;
