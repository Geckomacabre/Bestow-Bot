import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, TextDisplayBuilder } from 'discord.js';
import { hleaf } from '../../framework/heist.js';
import { inviteUrl } from '../../subcommands/info/bot.js';

/**
 * Heist+ is a second copy of the bot you can add to your account. Bestow+ works the same way when you run one:
 * set PLUS_CLIENT_ID to that application's ID. Without it, /plus offers this bot's own links.
 */
export default hleaf('plus', async i => {
  const plus = Bun.env.PLUS_CLIENT_ID;
  const id = plus || i.client.user?.id || i.client.application?.id || '';
  const name = plus ? 'Bestow+' : (i.client.user?.username ?? 'Bestow');
  const c = new ContainerBuilder().setAccentColor(0xf1c40f)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ✨ ${name}\nAdd ${name} to your account to use it in any server or DM, or add it to a server for the full feature set.`))
    .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Add to my account').setURL(inviteUrl(id, 'user')),
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Add to a server').setURL(inviteUrl(id)),
    ));
  await i.reply({ flags: MessageFlags.IsComponentsV2, components: [c] });
});
