import { randInt } from './random.js';

export type Card = { rank: string; suit: string };

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

export function newDeck(): Card[] {
  return SUITS.flatMap(suit => RANKS.map(rank => ({ rank, suit })));
}

export function shuffleDeck(deck: Card[]): Card[] {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [d[i], d[j]] = [d[j]!, d[i]!];
  }
  return d;
}

export const cardStr = (c: Card) => `${c.rank}${c.suit}`;
export const handStr = (cards: Card[]) => cards.map(cardStr).join(' ');

// ── Blackjack ─────────────────────────────────────────────────────────────────

export function bjValue(card: Card): number {
  if (['J','Q','K'].includes(card.rank)) return 10;
  if (card.rank === 'A') return 11;
  return parseInt(card.rank);
}

export function bjHandValue(cards: Card[]): number {
  let total = cards.reduce((sum, c) => sum + bjValue(c), 0);
  let aces = cards.filter(c => c.rank === 'A').length;
  while (total > 21 && aces-- > 0) total -= 10;
  return total;
}

// ── Poker ─────────────────────────────────────────────────────────────────────

export function rankIndex(rank: string): number {
  return RANKS.indexOf(rank); // 0=2 ... 12=A
}

type PokerResult = { name: string; multiplier: number };

export function evaluatePokerHand(cards: Card[]): PokerResult {
  const suits = cards.map(c => c.suit);
  const values = cards.map(c => rankIndex(c.rank)).sort((a, b) => a - b);
  const rankMap = new Map<string, number>();
  for (const c of cards) rankMap.set(c.rank, (rankMap.get(c.rank) ?? 0) + 1);
  const counts = [...rankMap.values()].sort((a, b) => b - a);

  const isFlush = suits.every(s => s === suits[0]);
  const isStd = values[4]! - values[0]! === 4 && new Set(values).size === 5;
  const isWheel = JSON.stringify(values) === JSON.stringify([0,1,2,3,12]);
  const isStraight = isStd || isWheel;
  const isRoyal = isFlush && isStd && values[4]! === 12 && values[0]! === 8;

  if (isRoyal)                                  return { name: 'Royal Flush',     multiplier: 250 };
  if (isFlush && isStraight)                    return { name: 'Straight Flush',  multiplier: 50  };
  if (counts[0] === 4)                          return { name: 'Four of a Kind',  multiplier: 25  };
  if (counts[0] === 3 && counts[1] === 2)       return { name: 'Full House',      multiplier: 9   };
  if (isFlush)                                  return { name: 'Flush',           multiplier: 6   };
  if (isStraight)                               return { name: 'Straight',        multiplier: 4   };
  if (counts[0] === 3)                          return { name: 'Three of a Kind', multiplier: 3   };
  if (counts[0] === 2 && counts[1] === 2)       return { name: 'Two Pair',        multiplier: 2   };
  if (counts[0] === 2) {
    const pairRank = [...rankMap.entries()].find(([, c]) => c === 2)?.[0] ?? '';
    if (rankIndex(pairRank) >= rankIndex('J'))  return { name: 'Jacks or Better', multiplier: 1   };
  }
  return { name: 'No Win', multiplier: 0 };
}
