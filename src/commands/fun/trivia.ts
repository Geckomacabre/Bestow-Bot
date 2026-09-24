import {
  ActionRowBuilder, ApplicationIntegrationType, ButtonBuilder, ButtonStyle,
  ChatInputCommandInteraction, ComponentType, ContainerBuilder, EmbedBuilder,
  InteractionContextType, MessageFlags, SlashCommandBuilder, TextDisplayBuilder,
  time, TimestampStyles,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { awardBonusXp } from '../../utils/xpBonus.js';
import he from 'he';

const TRIVIA_XP: Record<string, number> = { easy: 75, medium: 125, hard: 200 };

const IS_CV2 = MessageFlags.IsComponentsV2;

const TRIVIA_CATEGORIES = [
  { id: 11, name: 'Film' }, { id: 12, name: 'Music' }, { id: 14, name: 'Television' },
  { id: 15, name: 'Video Games' }, { id: 18, name: 'Computers' }, { id: 21, name: 'Sports' },
  { id: 23, name: 'History' }, { id: 22, name: 'Geography' }, { id: 24, name: 'Politics' },
  { id: 26, name: 'Celebrities' }, { id: 27, name: 'Animals' }, { id: 29, name: 'Comics' },
] as const;

const TRIVIA_COOLDOWN = 10_000;
const triviaCooldowns = new Map<string, number>();
const triviaActive = new Set<string>();

function triviaTimeLimit(difficulty?: string) {
  const base = difficulty === 'easy' ? 20000 : difficulty === 'medium' ? 14000 : 9000;
  return base + Math.floor(Math.random() * 4000 - 2000);
}

function buildResultRow(answers: string[], correct: string, pickedIndex: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    answers.map((ans, i) => new ButtonBuilder()
      .setCustomId(`locked_${i}`).setLabel(ans.slice(0, 80))
      .setStyle(ans === correct ? ButtonStyle.Success : i === pickedIndex ? ButtonStyle.Danger : ButtonStyle.Secondary)
      .setDisabled(true)
    ),
  );
}

const Trivia: Command = {
  data: new SlashCommandBuilder()
    .setName('trivia')
    .setDescription('Answer a random trivia question')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM]),

  async run(interaction: ChatInputCommandInteraction) {
    if (triviaActive.has(interaction.user.id)) {
      await interaction.reply({ content: 'You already have an active trivia game!', flags: MessageFlags.Ephemeral }); return;
    }
    const last = triviaCooldowns.get(interaction.user.id) ?? 0;
    const remaining = TRIVIA_COOLDOWN - (Date.now() - last);
    if (remaining > 0) {
      const retryAt = Math.floor((Date.now() + remaining) / 1000);
      const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Chill out!\nYou can use this again ${time(retryAt, TimestampStyles.RelativeTime)}`));
      await interaction.reply({ components: [container], flags: IS_CV2 }); return;
    }
    triviaActive.add(interaction.user.id);
    try {
      await interaction.deferReply();
      const category = TRIVIA_CATEGORIES[Math.floor(Math.random() * TRIVIA_CATEGORIES.length)];
      const res = await fetch(`https://opentdb.com/api.php?amount=1&type=multiple&category=${category.id}`);
      const data: any = await res.json();
      const question = data.results?.[0];
      if (!question) { await interaction.editReply('No trivia question found. Try again.'); triviaActive.delete(interaction.user.id); return; }
      const correct = he.decode(question.correct_answer);
      const answers = [correct, ...question.incorrect_answers.map((a: string) => he.decode(a))].sort(() => Math.random() - 0.5);
      const timeLimit = triviaTimeLimit(question.difficulty);
      const buttons = answers.map((ans, i) =>
        new ButtonBuilder().setCustomId(`trivia_${interaction.user.id}_${i}`).setLabel(ans.slice(0, 80)).setStyle(ButtonStyle.Primary)
      );
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
      const diff = question.difficulty.charAt(0).toUpperCase() + question.difficulty.slice(1).toLowerCase();
      const embed = new EmbedBuilder()
        .setDescription(`**${he.decode(question.question)}**\n*You have ${Math.floor(timeLimit / 1000)} seconds to answer*`)
        .addFields({ name: 'Difficulty', value: diff, inline: true }, { name: 'Category', value: category.name, inline: true });
      const msg = await interaction.editReply({ embeds: [embed], components: [row] });
      const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: timeLimit });
      collector.on('collect', async (btn) => {
        if (btn.user.id !== interaction.user.id) { await btn.reply({ content: "This isn't your game.", flags: MessageFlags.Ephemeral }); return; }
        const pickedIndex = parseInt(btn.customId.split('_').pop()!);
        const isCorrect = answers[pickedIndex] === correct;
        const nicknames = isCorrect ? ['wise guy', 'mega brain', 'smarty-pants'] : ['ninny', 'ignoramus', 'nitwit', 'moron'];
        const nickname = nicknames[Math.floor(Math.random() * nicknames.length)];
        let xpLine = '';
        if (isCorrect && interaction.guildId) {
          const xpGiven = await awardBonusXp({
            guildId: interaction.guildId, userId: interaction.user.id,
            baseAmount: TRIVIA_XP[question.difficulty] ?? 100,
            client: interaction.client, channelId: interaction.channelId, isGame: true,
          });
          xpLine = xpGiven > 0 ? ` +**${xpGiven} XP**!` : '';
        }
        await btn.update({
          embeds: [embed, new EmbedBuilder().setDescription(isCorrect ? `✅ You got that right, ${nickname}!${xpLine}` : `❌ Nope, ${nickname}. The correct answer was **${correct}**`)],
          components: [buildResultRow(answers, correct, pickedIndex)],
        });
        collector.stop();
      });
      collector.on('end', async (_c, reason) => {
        triviaActive.delete(interaction.user.id);
        triviaCooldowns.set(interaction.user.id, Date.now());
        if (reason !== 'time') return;
        await interaction.editReply({ content: "> Guess you didn't want to play trivia after all?", components: [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.map(b => b.setDisabled(true)))] }).catch(() => {});
      });
    } catch { triviaActive.delete(interaction.user.id); await interaction.editReply('Failed to fetch trivia question.').catch(() => {}); }
  },
};

export default Trivia;
