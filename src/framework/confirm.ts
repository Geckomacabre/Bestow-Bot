import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, type ChatInputCommandInteraction } from 'discord.js';

/**
 * Post a public prompt with Accept/Decline buttons that only `userId` can press, and wait for the answer.
 * Resolves false on decline or timeout. The prompt message is left in place (buttons removed) so the
 * caller can `editReply` the outcome.
 */
export async function askUser(
  interaction: ChatInputCommandInteraction,
  opts: { userId: string; content: string; acceptLabel?: string; declineLabel?: string; timeoutMs?: number },
): Promise<boolean> {
  const nonce = Math.random().toString(36).slice(2, 10);
  const acceptId = `ask:${nonce}:y`, declineId = `ask:${nonce}:n`;
  const row = (disabled: boolean) => new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(acceptId).setLabel(opts.acceptLabel ?? 'Accept').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(declineId).setLabel(opts.declineLabel ?? 'Decline').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
  const payload = (disabled: boolean, content = opts.content) => ({
    content, components: [row(disabled)], allowedMentions: { users: [opts.userId] },
  });

  const msg = interaction.deferred || interaction.replied
    ? await interaction.editReply(payload(false))
    : await interaction.reply({ ...payload(false), withResponse: true }).then(r => r.resource!.message!);

  try {
    const click = await msg.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: b => b.user.id === opts.userId && (b.customId === acceptId || b.customId === declineId),
      time: opts.timeoutMs ?? 60_000,
    });
    await click.update({ ...payload(true), components: [] });
    return click.customId === acceptId;
  } catch {
    await interaction.editReply({ content: `${opts.content}\n\n*⏰ No response — cancelled.*`, components: [] }).catch(() => {});
    return false;
  }
}
