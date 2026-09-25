import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, ModalBuilder, StringSelectMenuBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { hgroup, hsub } from '../../framework/heist.js';
import { onComponent, type ComponentInteraction } from '../../framework/router.js';
import { clearAccent, getAccent, parseColor, setAccent, toHex } from '../../customize/accent.js';

/** /customize color (✨): pick the accent color of every card Bestow sends you — a preset, any hex code, or back to default. */

export const PRESETS: [string, number][] = [
  ['Blurple', 0x5865f2], ['Red', 0xed4245], ['Orange', 0xe67e22], ['Yellow', 0xfee75c], ['Green', 0x57f287], ['Teal', 0x1abc9c],
  ['Blue', 0x3498db], ['Purple', 0x9b59b6], ['Pink', 0xeb459e], ['White', 0xf2f3f5], ['Black', 0x23272a], ['Gold', 0xf1c40f],
];

export async function colorPanel(userId: string, note?: string) {
  const cur = await getAccent(userId);
  const c = new ContainerBuilder().setAccentColor(cur ?? 0x5865f2)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🎨 Embed color\nThe color on the side of every card Bestow sends you.\n**Current:** ${cur != null ? `\`${toHex(cur)}\`` : 'default'}${note ? `\n\n${note}` : ''}`))
    .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId('cust:pick').setPlaceholder('Pick a color…')
      .addOptions(PRESETS.map(([label, hex]) => ({ label, value: String(hex), description: toHex(hex), default: cur === hex })))))
    .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('cust:hex').setStyle(ButtonStyle.Primary).setLabel('Custom hex…'),
      new ButtonBuilder().setCustomId('cust:reset').setStyle(ButtonStyle.Secondary).setLabel('Reset to default').setDisabled(cur == null)));
  return { flags: MessageFlags.IsComponentsV2 as const, components: [c] };
}

async function refresh(i: ComponentInteraction, note: string) {
  if (i.isModalSubmit()) { await i.reply({ ...(await colorPanel(i.user.id, note)), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }); return; }
  await i.update(await colorPanel(i.user.id, note));
}

onComponent('cust:', async i => {
  if (i.isStringSelectMenu() && i.customId === 'cust:pick') {
    const hex = Number(i.values[0]);
    await setAccent(i.user.id, hex);
    await refresh(i, `✅ Set to \`${toHex(hex)}\`.`);
  } else if (i.isButton() && i.customId === 'cust:hex') {
    await i.showModal(new ModalBuilder().setCustomId('cust:modal').setTitle('Custom embed color').addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId('hex').setLabel('Hex color').setPlaceholder('#ff8800').setStyle(TextInputStyle.Short).setMinLength(6).setMaxLength(7).setRequired(true))));
  } else if (i.isModalSubmit() && i.customId === 'cust:modal') {
    const hex = parseColor(i.fields.getTextInputValue('hex'));
    if (hex == null) { await i.reply({ content: '❌ Use a 6-digit hex code like `#ff8800`.', flags: MessageFlags.Ephemeral }); return; }
    await setAccent(i.user.id, hex);
    await refresh(i, `✅ Set to \`${toHex(hex)}\`.`);
  } else if (i.isButton() && i.customId === 'cust:reset') {
    await clearAccent(i.user.id);
    await refresh(i, '✅ Back to the default color.');
  }
});

export default hgroup({
  name: 'customize',
  subs: [hsub('customize color', async i => { await i.reply({ ...(await colorPanel(i.user.id)), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }); })],
});
