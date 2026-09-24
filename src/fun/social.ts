import { compatibility, dailyRating } from '../lookups/textfun.js';

/** Static copy and tiny pure helpers for the social/joke commands. All roasts and lines are playful and never target who someone *is*. */

export const RIZZ = [
  'Are you a keyboard? Because you\'re just my type.', 'Do you have a map? I keep getting lost in your profile picture.', 'Are you Wi-Fi? Because I\'m feeling a real connection.',
  'Is your name Google? Because you have everything I\'ve been searching for.', 'If you were a Discord role, you\'d be the one I never want to lose.', 'Are you a bug? Because you\'ve been on my mind all day and I can\'t fix you.',
  'You must be a 20-sided die, because you\'re a natural 20 in my book.', 'Are you a loading screen? Because I\'d wait for you forever.', 'Is this a voice channel? Because I\'d love to hear from you.',
  'Are you my Nitro? Because you make everything better.', 'Do you believe in love at first sync?', 'I must be a snowflake, because I\'ve fallen for you.',
  'You\'re the semicolon to my code — without you, nothing compiles.', 'Are you a ping? Because I feel a strong response every time you show up.', 'Roses are red, embeds are blue, I\'d 100% accept your friend request too.',
  'Are you an admin? Because you\'ve got all the permissions to my heart.', 'If you were a slash command, I\'d autocomplete you every time.', 'Is your name Ctrl+S? Because you\'re a keeper.',
  'Are you a cooldown? Because I keep counting the seconds until I see you again.', 'You must be made of copper and tellurium, because you\'re Cu-Te.',
];

export const ROASTS = [
  '{t} has the energy of a loading bar stuck at 99%.', '{t} types "brb" and returns three business days later.', 'If {t} were a Discord server, it\'d be 4,000 members and one active chat: "gm".',
  '{t}\'s Wi-Fi called. It said even it wants a break.', '{t} is the reason the mute button exists.', '{t} brings a PowerPoint to a group chat.', '{t} still says "no cap" and has never once been holding a cap.',
  '{t} has the confidence of someone who has never lost a game — because they\'ve never finished one.', 'I\'d roast {t}, but their search history already did.', '{t} is proof that "typing…" can go on for 20 minutes and produce "ok".',
  '{t} read the rules once and it shows.', '{t} joins voice chat, says nothing, and leaves. A true ghost.', '{t} has more unread notifications than hobbies.', '{t}\'s alt-tab game is stronger than their actual game.',
  '{t} thinks "low battery mode" is a personality.', '{t} left a group chat and somehow it made noise.', 'The only thing {t} carries is a grudge and a phone at 3%.',
];

export const SHIP_LINES: [number, string][] = [
  [10, 'Absolutely not. Not even as friends. 💀'], [25, 'Awkward. Maybe if a lot of time passes.'], [40, 'There\'s a spark… somewhere. Probably a short circuit.'], [55, 'Could work with effort and snacks.'],
  [70, 'Now we\'re talking! Cute together.'], [85, 'Whoa — a seriously good match! 💞'], [100, 'Soulmates. The bot has spoken. 💍'],
];
export const shipLine = (pct: number) => SHIP_LINES.find(([max]) => pct <= max)![1];

export const RATE_LINES: [number, string][] = [[10, 'Yikes.'], [30, 'Could be better.'], [50, 'Mid. Perfectly mid.'], [70, 'Pretty solid!'], [90, 'Excellent!'], [100, 'Perfection. No notes.']];
export const rateLine = (pct: number) => RATE_LINES.find(([max]) => pct <= max)![1];

/** A stable rating per thing per day, so asking twice gives the same answer today. */
export const rate = (thing: string, day?: string) => dailyRating(thing.trim().toLowerCase(), day);
export const shipScore = (idA: string, idB: string) => compatibility(idA, idB);

export const fill = (tpl: string, t: string) => tpl.replaceAll('{t}', t);
