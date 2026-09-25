import { Interaction, MessageFlags } from 'discord.js';
import commands from '../handlers/commandHandler';
import logger from '../utils/logger';
import * as db from '../utils/db';
import { handleReplyButton, handleReplyModal } from '../ai/conversation';
import { handleEnterButton } from '../giveaway/service';
import { handleStudioComponent, handleStudioModal } from '../subcommands/eco/studio';

export const onInteraction = async (interaction: Interaction) => {
  if (interaction.isAutocomplete()) {
    const command = commands.get(interaction.commandName);
    if (command?.autocomplete) {
      try {
        await command.autocomplete(interaction);
      } catch (err) {
        logger.error(`Autocomplete error for ${interaction.commandName}: ${err}`);
      }
    }
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('gw:enter:')) {
    await handleEnterButton(interaction).catch(err => logger.error(`Giveaway enter error: ${err}`));
    return;
  }

  // /eco wallet-edit studio: its buttons, menus and the colours form.
  if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith('ws:')) {
    await handleStudioComponent(interaction).catch(err => logger.error(`Wallet studio error: ${err}`));
    return;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('ws:')) {
    await handleStudioModal(interaction).catch(err => logger.error(`Wallet studio form error: ${err}`));
    return;
  }

  // AI conversations: the "Reply n/3" button opens a modal, whose submission continues the conversation.
  if (interaction.isButton() && interaction.customId.startsWith('ai:reply:')) {
    await handleReplyButton(interaction).catch(err => logger.error(`AI reply button error: ${err}`));
    return;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('ai:modal:')) {
    await handleReplyModal(interaction).catch(err => logger.error(`AI reply modal error: ${err}`));
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith('remove_quote:')) {
      const ownerId = interaction.customId.split(':')[1];
      if (interaction.user.id !== ownerId) {
        await interaction.reply({ content: '❌ Only the person who created this quote can remove it.', flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.message.delete().catch(() => {});
      await interaction.reply({ content: '✅ Quote removed.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return;
  }

  if (interaction.isMessageContextMenuCommand()) {
    const command = commands.get(interaction.commandName);
    if (command?.runMessage) {
      try {
        await command.runMessage(interaction);
      } catch (err) {
        logger.error(`Context menu error for ${interaction.commandName}: ${err}`);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'There was an error.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) return;



  try {
    if (typeof command.run === 'function') {
      await command.run(interaction);
    }
  } catch (error) {
    logger.error(`Error executing command ${interaction.commandName}: ${error}`);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'There was an error executing that command.', flags: MessageFlags.Ephemeral }).catch((err) => logger.error(`Error sending error response: ${err}`));
    } else if (interaction.deferred) {
      await interaction.editReply({ content: 'There was an error executing that command.' }).catch((err) => logger.error(`Error editing error response: ${err}`));
    }
  }
};
