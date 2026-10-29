import { ButtonStyle } from 'discord.js';
import { GAME_CLICKS, GAME_POSTS, slowDown } from '../framework/flood.js';
import { onComponent } from '../framework/router.js';
import { trunc } from '../lookups/card.js';
import { button, oops, panel, row } from './panel.js';
import { toggleVote, votesOn } from './store.js';

/**
 * Party games for a group chat, played entirely with buttons (the bot can't read the chat there):
 *  • Truth or dare: whoever presses Truth, Dare or Random gets a prompt, posted as a fresh panel so the game moves down the chat.
 *  • Never have I ever / would you rather: everyone answers on the same panel; Next posts the next prompt.
 *  • Pick: a random choice, with Pick again.
 * A prompt's number is part of its buttons' ids, so the lists below are append-only: add new prompts at the end.
 */

const PARTY = 0xeb459e;

export const TRUTHS = [
  'What\'s the last thing you searched on your phone?',
  'What\'s the most embarrassing thing you\'ve done in front of a crush?',
  'Who in this chat would you trust with a secret?',
  'What\'s a habit you have that nobody here knows about?',
  'What\'s the worst gift you\'ve ever received?',
  'What\'s your most irrational fear?',
  'Who was your first crush?',
  'What\'s the last lie you told?',
  'What\'s the most childish thing you still do?',
  'Have you ever pretended to be sick to get out of something?',
  'What\'s the worst haircut you\'ve ever had?',
  'What\'s a song you secretly love?',
  'What\'s the weirdest dream you remember?',
  'What\'s your guilty-pleasure TV show?',
  'What\'s the most money you\'ve wasted on something pointless?',
  'If you could swap lives with someone here for a day, who would it be?',
  'What\'s the most embarrassing photo in your camera roll?',
  'What\'s the dumbest way you\'ve ever hurt yourself?',
  'What\'s something you\'ve never told your parents?',
  'What\'s your biggest pet peeve?',
  'What\'s the worst date you\'ve been on?',
  'What\'s an opinion you have that would get you roasted in this chat?',
  'What\'s the most trouble you got into at school?',
  'What app do you spend way too much time on?',
  'What\'s the cringiest thing you\'ve ever posted online?',
  'What\'s a food you pretend to like?',
  'What\'s the last thing that made you cry?',
  'What\'s the pettiest thing you\'ve ever done?',
  'Who here would survive longest in a zombie apocalypse, and who would go first?',
  'What\'s your most used emoji, and why?',
  'What\'s a secret talent you have?',
  'What\'s the most awkward thing that happened to you this year?',
  'What did you last sing in the shower?',
  'What\'s the strangest thing you\'ve ever eaten?',
  'What\'s something you\'re proud of that you never get to brag about?',
  'What\'s the longest you\'ve left someone on read?',
  'Which person in this chat do you think you\'re most like?',
  'What\'s a movie everyone loves that you can\'t stand?',
  'What\'s the most ridiculous thing you\'ve cried over?',
  'If you had to delete one app forever, which would hurt the most?',
];

export const DARES = [
  'Send the 7th photo in your camera roll.',
  'Let the group pick your nickname for the next hour.',
  'Send a voice message singing the chorus of the last song you listened to.',
  'Type your next three messages with your eyes closed.',
  'Send a selfie with the ugliest face you can make.',
  'Send the last meme you saved.',
  'Describe your day using only emojis.',
  'Speak only in rhymes for your next five messages.',
  'Send a voice message doing your best impression of someone here.',
  'Use only CAPITAL LETTERS for the next 10 minutes.',
  'Show the last thing you bought online.',
  'Let the group choose your profile picture for an hour.',
  'Write a short poem about the last person who sent a message.',
  'Send a screenshot of your home screen.',
  'Do 10 push-ups and send a voice message of you counting them.',
  'Send the last GIF you used.',
  'Talk like a pirate for the next 5 minutes.',
  'Give everyone in this chat a compliment.',
  'Send a voice message saying the alphabet backwards.',
  'Let the group pick a word you have to sneak into every message for the next 10 minutes.',
  'Send a photo of whatever is directly in front of you right now.',
  'Write a fake five-star review for something in your room.',
  'Tell a joke. If nobody sends 😂, take another dare.',
  'Send a voice message of your best evil laugh.',
  'Reply to the next three messages with GIFs only.',
  'Share your screen time for today.',
  'Send a picture of your shoes.',
  'Explain the plot of your favourite movie badly, in one sentence.',
  'Send a 30-second voice message telling a bedtime story.',
  'Rate everyone\'s profile picture out of 10.',
  'Send the oldest photo of yourself you can find in under a minute.',
  'Type your next message with your elbows.',
  'Send a message in a language you don\'t speak (no translator!).',
  'Draw something in 30 seconds and send it.',
  'Be a news reporter and announce what\'s happening in this chat.',
  'Narrate your day in a dramatic movie-trailer voice message.',
  'Let someone here pick an emoji you must end every message with for 15 minutes.',
  'Confess something you did this week that you\'re not proud of.',
  'Send your most recent screenshot (no deleting first!).',
  'Change your status to something the group picks for an hour.',
];

export const NEVER = [
  'fallen asleep in a class or a meeting',
  'sent a text to the wrong person',
  'pretended to laugh at a joke I didn\'t get',
  'stayed up all night playing a game',
  'eaten food that fell on the floor',
  'forgotten someone\'s name right after they told me',
  'cried at a movie',
  'lied about my age',
  'broken a bone',
  'been on TV',
  'ghosted someone',
  'gone a whole day without my phone',
  'sung karaoke',
  'binge-watched a whole season in one day',
  'laughed so hard I snorted',
  'walked into a glass door',
  'pretended to be on the phone to avoid someone',
  'snooped through someone else\'s phone',
  'rage-quit a game',
  'tripped in public and played it off',
  'scrolled all the way to someone\'s oldest posts',
  'accidentally liked a really old post while scrolling',
  'been kicked out of a group chat',
  'faked being sick to skip school or work',
  'dyed my hair a wild colour',
  'slept for more than 12 hours straight',
  'eaten a whole pizza by myself',
  'talked to myself out loud in public',
  'cheated at a board game',
  'stayed in a call for more than 5 hours',
  'missed a flight or a train',
  'gone to the wrong place for a meetup',
  'screenshotted a chat to send to someone else',
  'waved back at someone who wasn\'t waving at me',
  'pulled an all-nighter for school',
  'been on a blind date',
  'been the last one awake at a sleepover',
  'left someone on read for more than a week',
  'gotten lost in my own town',
  'replied "you too" when a waiter said "enjoy your meal"',
];

export const WOULD_YOU_RATHER: [string, string][] = [
  ['Always be 10 minutes late', 'Always be 20 minutes early'],
  ['Lose all your money', 'Lose all your photos and memories'],
  ['Be able to fly', 'Be able to be invisible'],
  ['Never be able to use your phone again', 'Never be able to watch TV again'],
  ['Live without music', 'Live without movies'],
  ['Always be too hot', 'Always be too cold'],
  ['Be famous but hated', 'Be unknown but loved'],
  ['Have unlimited money but no friends', 'Have amazing friends but always be broke'],
  ['Always have to speak in rhymes', 'Always have to sing what you say'],
  ['Be able to speak every language', 'Be able to play every instrument'],
  ['Never eat sweets again', 'Never eat savoury food again'],
  ['Go back in time 100 years', 'Travel to the future 100 years'],
  ['Have a photographic memory', 'Have an IQ of 200'],
  ['Always know when people are lying', 'Always get away with lying'],
  ['Be the funniest person in the room', 'Be the smartest person in the room'],
  ['Only be able to whisper', 'Only be able to shout'],
  ['Live in a big city', 'Live in the countryside'],
  ['Have a rewind button for your life', 'Have a pause button for your life'],
  ['Never have to sleep', 'Never have to eat'],
  ['Be the main character', 'Be the funny sidekick'],
  ['Have a personal chef', 'Have a personal driver'],
  ['Give up your phone for a month', 'Give up junk food for a year'],
  ['Watch the same movie forever', 'Listen to the same song forever'],
  ['Have a pet dragon', 'Have a pet unicorn'],
  ['Live in the world of your favourite game', 'Live in the world of your favourite movie'],
  ['Read minds', 'See 10 seconds into the future'],
  ['Be a famous streamer', 'Be a famous musician'],
  ['Have no internet for a week', 'Have no hot water for a week'],
  ['Explore space', 'Explore the deep ocean'],
  ['Only text in emojis', 'Have autocorrect go wild on every message'],
  ['Be able to teleport', 'Be able to time travel'],
  ['Always have a song stuck in your head', 'Always feel like you forgot something'],
  ['Be in a group chat that never goes quiet', 'Be in one that\'s always dead'],
  ['Win the lottery', 'Live twice as long'],
];

const pick = <T>(xs: T[], not?: number): number => {
  if (xs.length < 2) return 0;
  let n = Math.floor(Math.random() * xs.length);
  if (n === not) n = (n + 1) % xs.length;
  return n;
};
const at = <T>(xs: T[], raw: string | undefined): number | null => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n < xs.length ? n : null;
};
const mentions = (ids: string[]) => (ids.length ? ids.map(u => `<@${u}>`).join(' ') : '—');

// ─── Truth or dare ────────────────────────────────────────────────────────────

const todButtons = () => row(
  button('gc:tod:truth', 'Truth', ButtonStyle.Success, '🗣️'),
  button('gc:tod:dare', 'Dare', ButtonStyle.Danger, '🔥'),
  button('gc:tod:random', 'Random', ButtonStyle.Primary, '🎲'),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function truthOrDarePanel(): any {
  return panel({ title: '🎲 Truth or Dare', body: 'Press **Truth**, **Dare** or **Random**. Whoever presses has to answer!', color: PARTY, rows: [todButtons()] });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function truthOrDarePrompt(kind: 'truth' | 'dare', userId: string, n = pick(kind === 'truth' ? TRUTHS : DARES)): any {
  const text = (kind === 'truth' ? TRUTHS : DARES)[n]!;
  return panel({
    title: kind === 'truth' ? '🗣️ Truth' : '🔥 Dare',
    body: `<@${userId}>, ${kind === 'truth' ? 'answer honestly' : 'your dare'}:\n> ${text}`,
    footer: 'Next person: press a button',
    color: kind === 'truth' ? 0x57f287 : 0xed4245,
    rows: [todButtons()],
  });
}

onComponent('gc:tod:', async i => {
  if (!i.isButton()) return;
  const choice = i.customId.slice('gc:tod:'.length);
  const kind = choice === 'random' ? (Math.random() < 0.5 ? 'truth' : 'dare') : choice;
  if (kind !== 'truth' && kind !== 'dare') return;
  if (await slowDown(i, [GAME_CLICKS, i.user.id], [GAME_POSTS, i.channelId ?? ''])) return; // each press is a new message
  await i.reply(truthOrDarePrompt(kind, i.user.id));
});

// ─── Never have I ever ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function neverPanel(n: number, messageId?: string): Promise<any> {
  const votes = messageId ? await votesOn(messageId) : [];
  const have = votes.filter(v => v.choice === 'have').map(v => v.user_id), never = votes.filter(v => v.choice === 'never').map(v => v.user_id);
  return panel({
    title: '🙊 Never have I ever…',
    body: `> …${NEVER[n]}.\n\n🙋 **I have (${have.length}):** ${mentions(have)}\n🙅 **Never (${never.length}):** ${mentions(never)}`,
    footer: 'Everyone answer with a button · press again to take it back',
    color: PARTY,
    rows: [row(
      button(`gc:nhie:${n}:have`, 'I have', ButtonStyle.Danger, '🙋'),
      button(`gc:nhie:${n}:never`, 'Never', ButtonStyle.Success, '🙅'),
      button(`gc:nhie:${n}:next`, 'Next', ButtonStyle.Secondary, '➡️'),
    )],
  });
}

export const randomNever = (not?: number) => pick(NEVER, not);

onComponent('gc:nhie:', async i => {
  if (!i.isButton()) return;
  const [, , raw, action] = i.customId.split(':');
  const n = at(NEVER, raw);
  if (n === null) return oops(i, 'That prompt is gone. Start a new round with `/group neverhaveiever`.');
  if (action === 'next') { if (!(await slowDown(i, [GAME_CLICKS, i.user.id], [GAME_POSTS, i.channelId ?? '']))) await i.reply(await neverPanel(randomNever(n))); return; }
  if (action !== 'have' && action !== 'never') return;
  await toggleVote(i.message.id, i.user.id, action);
  await i.update(await neverPanel(n, i.message.id));
});

// ─── Would you rather ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function wouldYouRatherPanel(n: number, messageId?: string): Promise<any> {
  const [a, b] = WOULD_YOU_RATHER[n]!;
  const votes = messageId ? await votesOn(messageId) : [];
  const va = votes.filter(v => v.choice === 'a').map(v => v.user_id), vb = votes.filter(v => v.choice === 'b').map(v => v.user_id);
  return panel({
    title: '🤔 Would you rather…',
    body: `🅰️ **${a}** (${va.length})\n${mentions(va)}\n\n🅱️ **${b}** (${vb.length})\n${mentions(vb)}`,
    footer: 'Vote with a button · press again to take it back',
    color: 0x9b59b6,
    rows: [row(
      button(`wyr:${n}:a`, trunc(a, 80), ButtonStyle.Primary, '🅰️'),
      button(`wyr:${n}:b`, trunc(b, 80), ButtonStyle.Primary, '🅱️'),
      button(`wyr:${n}:next`, 'Next', ButtonStyle.Secondary, '➡️'),
    )],
  });
}

export const randomWouldYouRather = (not?: number) => pick(WOULD_YOU_RATHER, not);

onComponent('wyr:', async i => {
  if (!i.isButton()) return;
  const [, raw, action] = i.customId.split(':');
  const n = at(WOULD_YOU_RATHER, raw);
  if (n === null) return oops(i, 'That question is gone. Ask a new one with `/community wouldyourather`.');
  if (action === 'next') { if (!(await slowDown(i, [GAME_CLICKS, i.user.id], [GAME_POSTS, i.channelId ?? '']))) await i.reply(await wouldYouRatherPanel(randomWouldYouRather(n))); return; }
  if (action !== 'a' && action !== 'b') return;
  await toggleVote(i.message.id, i.user.id, action);
  await i.update(await wouldYouRatherPanel(n, i.message.id));
});

// ─── Pick ─────────────────────────────────────────────────────────────────────

/** "pizza, sushi or tacos" / one per line → ['pizza', 'sushi', 'tacos']. */
export function splitChoices(raw: string): string[] {
  const parts = raw.split(/\r?\n|,|;|\|| or /i).map(s => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  return parts.filter(p => !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase())).slice(0, 50);
}

export function pickSome(choices: string[], count: number, rand = Math.random): string[] {
  const pool = [...choices];
  for (let k = pool.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [pool[k], pool[j]] = [pool[j]!, pool[k]!]; }
  return pool.slice(0, Math.max(1, Math.min(count, pool.length)));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pickPanel(choices: string[], count: number, userId: string): any {
  const picked = pickSome(choices, count);
  // The choices ride in the button's id so "Pick again" needs no storage; very long lists just don't get the button.
  const id = `gc:pick:${count}:${choices.join('|')}`;
  return panel({
    title: '🎯 I pick…',
    body: `${picked.length === 1 ? `## ${trunc(picked[0]!, 200)}` : picked.map((p, k) => `**${k + 1}.** ${trunc(p, 200)}`).join('\n')}\n-# out of ${choices.length}: ${trunc(choices.join(' · '), 900)}`,
    footer: `Picked for <@${userId}>`,
    color: 0xfee75c,
    rows: id.length <= 100 ? [row(button(id, 'Pick again', ButtonStyle.Secondary, '🔁'))] : [],
  });
}

onComponent('gc:pick:', async i => {
  if (!i.isButton()) return;
  const [, , rawCount, ...rest] = i.customId.split(':');
  const choices = rest.join(':').split('|').filter(Boolean);
  if (!choices.length) return;
  await i.update(pickPanel(choices, Number(rawCount) || 1, i.user.id));
});
