import {
  ApplicationIntegrationType, ChatInputCommandInteraction, Colors,
  ContainerBuilder, InteractionContextType, MessageFlags,
  SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import * as db from '../../utils/db';
import { cv2Text } from '../../utils/components.js';
import { addBirthdayHere, birthdayBoard, whereOf } from '../../groupchat/boards.js';
import { daysUntil, ordinal } from '../../groupchat/panel.js';
import { GroupError, MONTHS, getPersonalBirthday, removePersonalBirthday } from '../../groupchat/store.js';

const IS_CV2 = MessageFlags.IsComponentsV2;

/**
 * Birthdays work anywhere. You save yours once; it shows on the birthday board of each chat you add it to (setting it from a group
 * chat adds it there). In a server it also goes on the server's own list, which /server birthdays can announce.
 */
const Birthday: Command = {
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Birthday tracker commands')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addSubcommand(s => s.setName('set').setDescription('Set your birthday')
      .addIntegerOption(o => o.setName('month').setDescription('Month (1-12)').setRequired(true).setMinValue(1).setMaxValue(12))
      .addIntegerOption(o => o.setName('day').setDescription('Day').setRequired(true).setMinValue(1).setMaxValue(31)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove your birthday'))
    .addSubcommand(s => s.setName('view').setDescription("View a user's birthday")
      .addUserOption(o => o.setName('user').setDescription('User to view (defaults to you)')))
    .addSubcommand(s => s.setName('list').setDescription('Upcoming birthdays here, with a button to add yours')),

  async run(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const w = whereOf(interaction);

    if (sub === 'set') {
      const month = interaction.options.getInteger('month', true);
      const day = interaction.options.getInteger('day', true);
      try {
        await addBirthdayHere(w, interaction.user.id, month, day);
      } catch (e) {
        if (!(e instanceof GroupError)) throw e;
        await interaction.reply({ ...cv2Text(`❌ ${e.message}`), flags: IS_CV2 | MessageFlags.Ephemeral });
        return;
      }
      const where = w.guildId ? 'It\'s on this server\'s birthday list.' : `It's on the birthday board of ${w.place === 'dm' ? 'this DM' : 'this group chat'} (\`/group birthdays\`). Add it to another chat with **🎂 Add mine** there.`;
      await interaction.reply({ ...cv2Text(`✅ Your birthday has been set to **${MONTHS[month - 1]} ${ordinal(day)}**.\n${where}`), flags: IS_CV2 | MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'remove') {
      const had = await removePersonalBirthday(interaction.user.id);
      if (w.guildId) await db.removeBirthday(w.guildId, interaction.user.id);
      const note = w.guildId ? ' It\'s off this server\'s list and every chat board.' : had ? ' It\'s off every chat board.' : '';
      await interaction.reply({ ...cv2Text(`✅ Your birthday has been removed.${note}`), flags: IS_CV2 | MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'view') {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const bday = (w.guildId ? await db.getBirthday(w.guildId, user.id) : null) ?? await getPersonalBirthday(user.id);
      if (!bday) {
        await interaction.reply({ ...cv2Text(`${user.id === interaction.user.id ? 'You have' : `**${user.username}** has`} no birthday set.`), flags: IS_CV2 | MessageFlags.Ephemeral });
        return;
      }
      const days = daysUntil(bday.month, bday.day);
      const container = new ContainerBuilder()
        .setAccentColor(Colors.Gold)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `**🎂 ${user.username}'s Birthday**\n**Date:** ${MONTHS[bday.month - 1]} ${ordinal(bday.day)}\n**Coming up in:** ${days === 0 ? '🎉 Today!' : `${days} day${days === 1 ? '' : 's'}`}`
        ));
      await interaction.reply({ flags: IS_CV2, components: [container] });
      return;
    }

    if (sub === 'list') {
      await interaction.reply(await birthdayBoard(w));
    }
  },
};

export default Birthday;
