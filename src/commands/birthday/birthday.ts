import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  ContainerBuilder, InteractionContextType, MessageFlags,
  SlashCommandBuilder, TextDisplayBuilder,
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

function daysUntilBirthday(month: number, day: number): number {
  const now = new Date();
  const year = now.getFullYear();
  let next = new Date(year, month - 1, day);
  if (next <= now) next = new Date(year + 1, month - 1, day);
  return Math.ceil((next.getTime() - now.getTime()) / 86_400_000);
}

const Birthday: Command = {
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Birthday tracker commands')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(s => s.setName('set').setDescription('Set your birthday')
      .addIntegerOption(o => o.setName('month').setDescription('Month (1-12)').setRequired(true).setMinValue(1).setMaxValue(12))
      .addIntegerOption(o => o.setName('day').setDescription('Day').setRequired(true).setMinValue(1).setMaxValue(31)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove your birthday from this server'))
    .addSubcommand(s => s.setName('view').setDescription("View a user's birthday")
      .addUserOption(o => o.setName('user').setDescription('User to view (defaults to you)')))
    .addSubcommand(s => s.setName('list').setDescription('List upcoming birthdays in this server')),

  async run(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const month = interaction.options.getInteger('month', true);
      const day = interaction.options.getInteger('day', true);
      if (day > DAYS_IN_MONTH[month - 1]) {
        await interaction.reply({ ...cv2Text(`❌ ${MONTHS[month - 1]} only has ${DAYS_IN_MONTH[month - 1]} days.`), flags: IS_CV2 | MessageFlags.Ephemeral });
        return;
      }
      await db.setBirthday(interaction.guildId!, interaction.user.id, month, day);
      await interaction.reply({ ...cv2Text(`✅ Your birthday has been set to **${MONTHS[month - 1]} ${ordinal(day)}**.`), flags: IS_CV2 | MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'remove') {
      await db.removeBirthday(interaction.guildId!, interaction.user.id);
      await interaction.reply({ ...cv2Text('✅ Your birthday has been removed.'), flags: IS_CV2 | MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'view') {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const bday = await db.getBirthday(interaction.guildId!, user.id);
      if (!bday) {
        await interaction.reply({ ...cv2Text(`${user.id === interaction.user.id ? 'You have' : `**${user.username}** has`} no birthday set.`), flags: IS_CV2 | MessageFlags.Ephemeral });
        return;
      }
      const days = daysUntilBirthday(bday.month, bday.day);
      const container = new ContainerBuilder()
        .setAccentColor(Colors.Gold)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `**🎂 ${user.username}'s Birthday**\n**Date:** ${MONTHS[bday.month - 1]} ${ordinal(bday.day)}\n**Coming up in:** ${days === 0 ? '🎉 Today!' : `${days} day${days === 1 ? '' : 's'}`}`
        ));
      await interaction.reply({ flags: IS_CV2, components: [container] });
      return;
    }

    if (sub === 'list') {
      const birthdays = await db.getBirthdays(interaction.guildId!);
      if (!birthdays.length) {
        await interaction.reply({ ...cv2Text('No birthdays set in this server yet.'), flags: IS_CV2 | MessageFlags.Ephemeral });
        return;
      }
      const sorted = birthdays
        .map(b => ({ ...b, days: daysUntilBirthday(b.month, b.day) }))
        .sort((a, b) => a.days - b.days)
        .slice(0, 20);
      const lines = sorted.map(b =>
        `<@${b.user_id}> — ${MONTHS[b.month - 1]} ${ordinal(b.day)} (${b.days === 0 ? '🎉 Today!' : `in ${b.days}d`})`
      );
      const container = new ContainerBuilder()
        .setAccentColor(Colors.Gold)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**🎂 Upcoming Birthdays**\n\n${lines.join('\n')}`));
      await interaction.reply({ flags: IS_CV2, components: [container] });
    }
  },
};

export default Birthday;
