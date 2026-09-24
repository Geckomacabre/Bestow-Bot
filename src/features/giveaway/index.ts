import { Client, EmbedBuilder, Colors, ButtonInteraction, TextChannel, Guild } from 'discord.js';
import * as db from '../../utils/db';

function pickWinners(entries: string[], count: number): string[] {
  const shuffled = [...entries].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

// Entries persist after a member leaves (or never belonged to this guild) —
// restrict to current members so we never draw someone who can't collect the prize.
export async function filterEligibleEntries(guild: Guild | null, entries: string[]): Promise<string[]> {
  if (!guild) return [];
  const members = await guild.members.fetch().catch(() => guild.members.cache);
  const memberIds = new Set(members.keys());
  return entries.filter(id => memberIds.has(id));
}

export async function endGiveawayById(bot: Client, giveaway: db.IGiveaway) {
  await db.endGiveaway(giveaway.id);
  const guild = await bot.guilds.fetch(giveaway.guild_id).catch(() => null);
  const entries = await db.getGiveawayEntries(giveaway.id);
  const eligibleEntries = await filterEligibleEntries(guild, entries);
  const winners = pickWinners(eligibleEntries, giveaway.winner_count);

  const channel = guild?.channels.cache.get(giveaway.channel_id) as TextChannel | null;
  if (!channel || !giveaway.message_id) return;

  const msg = await channel.messages.fetch(giveaway.message_id).catch(() => null);
  const winnerMentions = winners.length > 0 ? winners.map(id => `<@${id}>`).join(', ') : 'No valid entries';

  const embed = new EmbedBuilder()
    .setColor(Colors.Gold)
    .setTitle(`🎉 Giveaway Ended — ${giveaway.prize}`)
    .addFields(
      { name: 'Winners', value: winnerMentions },
      { name: 'Entries', value: entries.length.toString(), inline: true },
      { name: 'Hosted by', value: `<@${giveaway.host_id}>`, inline: true },
    )
    .setTimestamp();

  if (msg) await msg.edit({ content: '🎉 **GIVEAWAY ENDED** 🎉', embeds: [embed], components: [] }).catch(() => {});

  if (winners.length > 0) {
    await channel.send({ content: `🎊 Congratulations ${winnerMentions}! You won **${giveaway.prize}**!` }).catch(() => {});
  } else if (entries.length > 0) {
    await channel.send({ content: '😔 Everyone who entered has left the server — no valid winners.' }).catch(() => {});
  } else {
    await channel.send({ content: '😔 No one entered the giveaway.' }).catch(() => {});
  }
}

export function startGiveawayChecker(bot: Client) {
  setInterval(async () => {
    const expired = await db.getExpiredGiveaways();
    for (const g of expired) {
      await endGiveawayById(bot, g).catch(console.error);
    }
  }, 30_000);
}

const giveawayModule = {
  name: 'giveaway',
  handlers: {
    interactionCreate: async ({ data: [interaction], bot }: { data: [ButtonInteraction]; bot: Client }) => {
      if (!interaction.isButton()) return;
      if (!interaction.customId.startsWith('giveaway_enter_')) return;

      const id = parseInt(interaction.customId.replace('giveaway_enter_', ''));
      if (isNaN(id)) return;

      const giveaway = await db.getGiveaway(id, interaction.guildId!);
      if (!giveaway || giveaway.ended) {
        await interaction.reply({ content: 'This giveaway has already ended.', flags: 64 });
        return;
      }

      const { entered, count } = await db.enterGiveaway(id, interaction.user.id);
      if (entered) {
        await interaction.reply({ content: `🎉 You entered the giveaway for **${giveaway.prize}**! (${count} entries total)`, flags: 64 });
      } else {
        await interaction.reply({ content: `You're already entered! (${count} entries total)`, flags: 64 });
      }
    },
  },
};

export default giveawayModule;
