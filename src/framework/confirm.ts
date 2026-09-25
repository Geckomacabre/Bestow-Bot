import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js';
import { cv2Panel } from '../utils/components.js';

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

/**
 * Heist's purchase confirmation: a card with a title, a divider and the question, and Confirm / Cancel buttons under it that only
 * `userId` can press. Resolves with the Confirm click — still unanswered, so the caller finishes the job and shows the result
 * with `click.update(...)` — or null when the user cancelled or never answered (the card is then already updated to say so).
 */
export async function confirmPanel(
  interaction: ChatInputCommandInteraction,
  opts: { userId: string; header: string; body: string; cancelHeader?: string; cancelBody?: string; timeoutMs?: number },
): Promise<ButtonInteraction | null> {
  const nonce = Math.random().toString(36).slice(2, 10);
  const yes = `confirm:${nonce}:y`, no = `confirm:${nonce}:n`;
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(yes).setLabel('Confirm').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(no).setLabel('Cancel').setStyle(ButtonStyle.Danger),
  );
  const panel = cv2Panel(opts.header, opts.body);
  const msg = await interaction.reply({ ...panel, components: [...panel.components, buttons], withResponse: true }).then(r => r.resource!.message!);
  try {
    const click = await msg.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: b => b.user.id === opts.userId && (b.customId === yes || b.customId === no),
      time: opts.timeoutMs ?? 60_000,
    });
    if (click.customId === yes) return click;
    await click.update(cv2Panel(opts.cancelHeader ?? 'Cancelled', opts.cancelBody ?? 'Nothing was bought.'));
  } catch {
    await interaction.editReply(cv2Panel(opts.cancelHeader ?? 'Cancelled', 'No response, so nothing was bought.')).catch(() => {});
  }
  return null;
}
