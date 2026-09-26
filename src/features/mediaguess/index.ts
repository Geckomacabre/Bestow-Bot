import {
  ActionRowBuilder, ButtonInteraction, Client, InteractionContextType, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
  type ChatInputCommandInteraction, type ModalSubmitInteraction,
} from 'discord.js';
import { EventModule } from '../feature';
import {
  activeGames, castVoteSkip, checkGuess, GUESS_BUTTON, GUESS_INPUT, GUESS_MODAL, INTERACTIVE_NEXT_PREFIX, interactiveNextButton, NEXT_ROUND_PREFIX, nextRoundButton,
  requestHint, resolveGame, restoreActiveGames, roundBusy, safeName, startGame, startInteractiveRound, STOP_PREFIX, stopGame, submitGuess, tidyAtEnd, deleteLater, type InteractiveHost, type MediaType,
} from '../../utils/mediagame';
import { awardBonusXp } from '../../utils/xpBonus';
import * as db from '../../utils/db';
import { recordGameResult } from '../../utils/db';

// Patterns that indicate normal chat rather than a guess attempt.
// Movie/show titles virtually never match these.
const CHAT_PATTERNS: RegExp[] = [
  /\?$/,                                                       // ends with question mark
  /^(lol|lmao|lmfao|haha+|hehe+|omg|wtf|bruh|bro|gg|lmk|smh|ngl|fr|frl|frfr|imo|imho)\b/i,
  /^(yes|no|yeah|nah|yep|nope|ok|okay|sure|maybe|idk|same|true|facts|cap|no cap|based)$/i,
  /^(nice|cool|damn|dang|wow|woah|whoa|sick|fire|mid|lowkey|highkey)\b/i,
  /^i (think|know|don'?t|feel|heard|saw|watched|seen|remember|bet|guess|give up)/i,
  /^i'(m|ve|d|ll) /i,
  /^(do|did|have|has|can|could|would|should|will|is|are|was|were) (you|we|they|he|she|it)\b/i,
  /^(what|why|how|when|where|who|whose|which) /i,
  /^(this|that|it) (is|was|looks|seems|sounds|feels|has to|must)/i,
  /^(oh|ah|ugh|oof|yikes|damn|rip)\b/i,
  /^no (way|idea|clue|cap)\b/i,
  /^(never|always|literally|actually|honestly|obviously|definitely|probably)\b/i,
  /^(wait|hold on|omg wait)\b/i,
  /^(good|great|bad|awful|amazing|terrible|perfect|wrong)\b/i,
  /^(guys|everyone|somebody|anyone)\b/i,
  /^(i )?give up$/i,
];

function looksLikeChat(text: string): boolean {
  const t = text.trim();
  if (t.length > 80) return true;
  // No latin letters or digits = pure emoji / symbols, not a title guess
  if (!/[a-zA-Z0-9]/.test(t)) return true;
  return CHAT_PATTERNS.some(p => p.test(t));
}

// Hints are free and shared (see requestHint() in mediagame.ts), so a correct
// guess always pays the full reward regardless of how many hints were used.
const CORRECT_GUESS_XP = 150;

const mediaguessModule: EventModule = {
  name: 'mediaguess',
  handlers: {
    messageCreate: async ({ data: [message], bot }) => {
      // Server channels and solo rounds in someone's DMs alike — the channel only matters if it has a live round.
      if (message.author.bot) return;
      if (!message.content || message.content.startsWith('/') || message.content.length < 2) return;

      const state = activeGames.get(message.channelId);
      if (!state || state.answered) return;

      // Let normal conversation through without reacting — except for music,
      // where real song titles ("Good 4 U", "Wow") collide with these chat
      // heuristics often enough that skipping the filter is the safer call.
      if (state.type !== 'music' && looksLikeChat(message.content)) return;

      const result = checkGuess(message.content.trim(), state.media.title);

      if (result === 'correct') {
        // Lock immediately before any await so concurrent correct guesses can't both win
        if (state.answered) return;
        state.answered = true;

        // XP and game stats are per server, so a DM round is just for fun.
        const xpGained = message.guildId
          ? await awardBonusXp({
            guildId: message.guildId,
            userId: message.author.id,
            baseAmount: CORRECT_GUESS_XP,
            client: bot,
            channelId: message.channelId,
            isGame: true,
          })
          : 0;

        if (message.guildId) recordGameResult(message.guildId, message.author.id, `mediaguess_${state.type}`, true, 0).catch(() => {});

        await message.react('✅').catch(() => {});
        // Music folds XP into resolveGame's structured embed instead of a
        // separate reply — movie/tv/game keep the plain-text announcement.
        if (state.type !== 'music' && xpGained > 0) {
          await message.reply(`+${xpGained} XP 🎉`).catch(() => {});
        }
        const winnerName = message.member?.displayName ?? message.author.globalName ?? message.author.username;
        await resolveGame(state, bot, { id: message.author.id, name: winnerName, xpGained }, 'correct');
      } else if (result === 'very_close') {
        await message.react('‼️').catch(() => {});
      } else if (result === 'close') {
        await message.react('❗').catch(() => {});
      }
    },

    interactionCreate: async ({ data: [interaction] }) => {
      if (interaction.isModalSubmit()) {
        if (interaction.customId === GUESS_MODAL) await guessFromModal(interaction);
        return;
      }
      if (!interaction.isButton()) return;
      const btn = interaction as ButtonInteraction;
      if (btn.customId === GUESS_BUTTON) return openGuessBox(btn);
      if (btn.customId.startsWith(INTERACTIVE_NEXT_PREFIX)) return nextInteractiveRound(btn);
      if (btn.customId.startsWith(NEXT_ROUND_PREFIX)) return nextRound(btn);
      if (btn.customId.startsWith(STOP_PREFIX)) return stopFromButton(btn);
      if (btn.customId !== 'mg_hint' && btn.customId !== 'mg_voteskip') return;

      if (btn.customId === 'mg_hint') {
        // Deferred and public — hints are shared with the whole channel. The
        // defer is needed because music's "Extended Snippet" hint downloads
        // and trims audio, which can take longer than Discord's 3-second
        // interaction window.
        await btn.deferReply();
        tidyReply(btn);
        const payload = await requestHint(btn.channelId, btn.user.id);
        if (!payload) {
          await btn.editReply({ content: '❌ There is no active guessing game in this channel.' });
          return;
        }
        await btn.editReply(payload as any).catch(() => {}); // already tidied away if the round ended meanwhile
        return;
      }

      // mg_voteskip — in a group-chat game the person who started it can skip on their own, and anyone else needs two people to vote
      // (see castVoteSkip). A DM round is skipped on the spot; a server round is a public vote with a delay.
      const live = activeGames.get(btn.channelId);
      // A solo round (DM, or run through interactions) may be skipped on the spot, and the game goes on; acknowledge first, since revealing
      // a song downloads its full clip. A server round is a public vote.
      const solo = !!live && !live.guildId && !live.answered;
      if (solo) { await btn.deferReply(); tidyReply(btn); }
      const { content } = await castVoteSkip(btn.channelId, btn.user.id, btn.client, live?.interactive ? followHost(btn) : undefined);
      if (solo) await btn.editReply({ content: content === '⏭️ Round skipped.' ? `⏭️ **${safeName(displayName(btn))}** skipped the round.` : content, allowedMentions: { parse: [] } }).catch(() => {});
      else await btn.reply({ content });
    },
  },
};

export default mediaguessModule;

const NO_ROUND = '❌ There is no active guessing game in this channel — start one with `/community guess`.';

/** The Guess button: opens a box to type the answer in (the bot can't read chat here, so guesses arrive as form submissions). */
async function openGuessBox(btn: ButtonInteraction): Promise<void> {
  const live = activeGames.get(btn.channelId);
  if (!live || live.answered) { await btn.reply({ content: NO_ROUND }); return; }
  await btn.showModal(new ModalBuilder().setCustomId(GUESS_MODAL).setTitle(`Guess the ${live.type === 'tv' ? 'show' : live.type === 'music' ? 'song' : live.type}`).addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(GUESS_INPUT).setLabel('Your guess').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100))));
}

/** A submitted guess: everyone in the chat sees it and how close it was, like typing in a channel; a correct one also rewrites the round. */
async function guessFromModal(modal: ModalSubmitInteraction): Promise<void> {
  const name = modal.member && 'displayName' in modal.member ? (modal.member.displayName as string) : modal.user.globalName ?? modal.user.username;
  const text = modal.fields.getTextInputValue(GUESS_INPUT);
  await modal.deferReply(); // a right answer rewrites the round (and may fetch a song's full clip): acknowledge first
  tidyReply(modal);
  const result = await submitGuess(modal.channelId ?? '', text, { id: modal.user.id, name }, modal.client, followHost(modal));
  await modal.editReply({ content: guessLine(name, text, result), allowedMentions: { parse: [] } }).catch(() => {}); // already tidied away if it ended the round
}

/**
 * Marks this interaction's public reply to be removed when the round it belongs to ends, so guesses, hints and skip votes don't pile
 * up in the chat (see tidyAtEnd). Does nothing outside a group-chat round.
 */
export function tidyReply(i: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction): void {
  tidyAtEnd(i.channelId ?? '', i.id, () => i.deleteReply());
}

const VERDICT = { correct: '✅ correct!', very_close: '‼️ very close!', close: '❗ close!', wrong: '❌ not quite.' } as const;

/** The public line for a guess: who guessed what, and how it went. A guess is a person's own words, so it is made safe to show. */
export function guessLine(name: string, text: string, result: keyof typeof VERDICT | 'no-round'): string {
  return result === 'no-round' ? NO_ROUND : `**${safeName(name)}** guessed **${safeName(text)}** — ${VERDICT[result]}`;
}

/**
 * Where a game run through interactions posts and edits: this interaction's own follow-ups and webhook (valid for 15 minutes from it).
 * Every round is anchored to the interaction that ended the one before, so the game keeps going for as long as people keep playing.
 */
export function followHost(i: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction): InteractiveHost {
  return {
    client: i.client, channelId: i.channelId ?? '', userId: i.user.id, via: i.id,
    send: payload => i.followUp(payload).then(m => ({ id: m.id })),
    edit: (id, payload) => i.webhook.editMessage(id, payload),
    remove: id => i.webhook.deleteMessage(id),
  };
}

/** The Stop game button: ends the game, whether a round is live or the next one is about to start. */
async function stopFromButton(btn: ButtonInteraction): Promise<void> {
  const type = btn.customId.slice(STOP_PREFIX.length) as MediaType;
  await btn.deferUpdate(); // revealing the answer can take a moment (a song's full clip)
  const stopped = await stopGame(btn.channelId, btn.client);
  if (stopped === 'nothing') { await btn.followUp({ content: '⏹️ There\'s no game running here to stop.' }); return; }
  if (stopped === 'pending') {
    // Stopped in the gap between rounds: this message is the result of the last one, so turn its Stop button into a way to play again.
    const again = btn.context === InteractionContextType.BotDM ? nextRoundButton(type) : interactiveNextButton(type);
    await btn.editReply({ content: `${btn.message.content}\n⏹️ Game stopped.`, components: [again] }).catch(() => {});
  }
  const note = await btn.followUp({ content: `⏹️ **${safeName(displayName(btn))}** stopped the game.`, allowedMentions: { parse: [] } }).catch(() => null);
  if (note) deleteLater(() => btn.webhook.deleteMessage(note.id)); // the last thing the game says goes too, like its results
}

/** How the person who pressed a button is named in the chat. */
function displayName(i: ButtonInteraction): string {
  return 'displayName' in (i.member ?? {}) ? (i.member as { displayName: string }).displayName : i.user.globalName ?? i.user.username;
}

/** "Next round" under a finished interactive round: take the button off, and post a fresh round as a new message. */
async function nextInteractiveRound(btn: ButtonInteraction): Promise<void> {
  const type = btn.customId.slice(INTERACTIVE_NEXT_PREFIX.length) as MediaType;
  if (!['movie', 'tv', 'game', 'music'].includes(type)) return;
  if (roundBusy(btn.channelId)) { await btn.reply({ content: '❌ There\'s already a round going — make a guess, or use **Skip**.' }); return; }
  const missing = keyMissing(type);
  if (missing) { await btn.reply({ content: missing }); return; }
  await btn.update({ components: [] });
  if (!(await startInteractiveRound(followHost(btn), type).catch(() => false))) {
    await btn.editReply({ components: [interactiveNextButton(type)] }).catch(() => {}); // put the button back so they can retry
    await btn.followUp({ content: '😵 I couldn\'t load a new round just now — try again in a moment.' }).catch(() => {});
  }
}

/** "Next round" under a finished DM round: take the button off that message and post a fresh round of the same kind. */
async function nextRound(btn: ButtonInteraction): Promise<void> {
  const type = btn.customId.slice(NEXT_ROUND_PREFIX.length) as MediaType;
  if (btn.guildId || !['movie', 'tv', 'game', 'music'].includes(type)) return;
  if (roundBusy(btn.channelId)) {
    await btn.reply({ content: '❌ There\'s already a round going — make a guess, or use **Skip**.' });
    return;
  }
  const missing = keyMissing(type);
  if (missing) {
    await btn.reply({ content: missing });
    return;
  }
  await btn.update({ components: [] });
  if (!(await startGame(null, btn.channelId, type, btn.client).catch(() => false))) {
    await btn.editReply({ components: [nextRoundButton(type)] }).catch(() => {}); // put the button back so they can retry
    await btn.followUp({ content: '😵 I couldn\'t load a new round just now — try again in a moment.' }).catch(() => {});
  }
}

/** Why a guessing mode can't run on this bot, or null when its API key is set. */
export function keyMissing(type: MediaType): string | null {
  if ((type === 'movie' || type === 'tv') && !Bun.env.TMDB_API_KEY) return '❌ Movie and TV guessing isn\'t set up on this bot yet (it needs a `TMDB_API_KEY`).';
  if (type === 'game' && !Bun.env.RAWG_API_KEY) return '❌ Video game guessing isn\'t set up on this bot yet (it needs a `RAWG_API_KEY`).';
  return null;
}

// Movie/TV need TMDB, games need RAWG — music (Deezer) needs no key at all.
// Each type is gated independently so a missing key only disables that one
// mode instead of blocking every guessing game in the server.
async function startIfConfigured(guildId: string, channelId: string | null, type: 'movie' | 'tv' | 'game' | 'music', client: Client): Promise<void> {
  if (!channelId || activeGames.has(channelId)) return;
  if ((type === 'movie' || type === 'tv') && !Bun.env.TMDB_API_KEY) {
    console.warn(`[mediaguess] TMDB_API_KEY not set — ${type} guessing disabled`);
    return;
  }
  if (type === 'game' && !Bun.env.RAWG_API_KEY) {
    console.warn('[mediaguess] RAWG_API_KEY not set — game guessing disabled');
    return;
  }
  await startGame(guildId, channelId, type, client).catch(console.error);
}

export async function startMediaGames(client: Client): Promise<void> {
  // Resume any round that was still in progress before the restart, so
  // configured channels don't get force-reset to a brand new round.
  await restoreActiveGames(client);

  const configs = await db.getAllMediaGuessConfigs();
  for (const cfg of configs) {
    await startIfConfigured(cfg.guild_id, cfg.movie_channel_id, 'movie', client);
    await startIfConfigured(cfg.guild_id, cfg.tv_channel_id, 'tv', client);
    await startIfConfigured(cfg.guild_id, cfg.game_channel_id, 'game', client);
    await startIfConfigured(cfg.guild_id, cfg.music_channel_id, 'music', client);
  }
}
