import { ApplicationIntegrationType, ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder,
  MessageFlags,
} from 'discord.js';
import { Command } from '../../interfaces/command';

const Roll: Command = {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll dice (e.g. 2d6, 1d20)')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM])
    .addStringOption(o => o.setName('dice').setDescription('Dice expression like 2d6 or 1d20+5 (default: 1d6)')) as any,

  async run(interaction: ChatInputCommandInteraction) {
    const expr = interaction.options.getString('dice') ?? '1d6';
    const match = /^(\d+)d(\d+)([+-]\d+)?$/i.exec(expr.trim());
    if (!match) { await interaction.reply({ content: '❌ Invalid dice format. Use e.g. `2d6`, `1d20`, `1d8+3`.', flags: MessageFlags.Ephemeral }); return; }

    const count = Math.min(parseInt(match[1]), 20);
    const sides = Math.min(parseInt(match[2]), 1000);
    const mod = match[3] ? parseInt(match[3]) : 0;

    const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
    const total = rolls.reduce((a, b) => a + b, 0) + mod;

    const detail = count > 1 ? ` [${rolls.join(', ')}]` : '';
    const modStr = mod !== 0 ? ` ${mod > 0 ? '+' : ''}${mod}` : '';
    await interaction.reply(`🎲 **${expr}** → ${detail}${modStr} = **${total}**`);
  },
};

export default Roll;
