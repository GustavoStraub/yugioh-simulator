import type { PracticeGuideLesson } from '@/lib/domain/deck-guide';
import { deckAfterOpeningHand } from '@/lib/duel/opening-hand';
import type { DuelDeckPayload } from '@/lib/types';

/** Each prepared card replaces a real copy; opening hands are removed later by DuelSession. */
export function practiceSetup(deck: DuelDeckPayload, lesson: PracticeGuideLesson) {
  const decks = [deck, deck].map(d => ({ ...d, main: [...d.main], extra: [...d.extra], side: [...d.side] }));
  const scenario = lesson.practice.scenario ?? [];
  const occupied = new Set<string>();
  for (const card of scenario) {
    if (![0, 1].includes(card.player) || ![4, 8, 16, 32].includes(card.location)) throw new Error('Zona de treino inválida.');
    if ([4, 8].includes(card.location)) {
      const max = card.location === 4 ? 6 : 5;
      if (!Number.isInteger(card.sequence) || card.sequence! < 0 || card.sequence! > max) throw new Error('Posição de treino inválida.');
      const key = card.location === 4 && card.sequence! >= 5 ? `extra:${card.player === 0 ? card.sequence : 11 - card.sequence!}` : `${card.player}:${card.location}:${card.sequence}`;
      if (occupied.has(key)) throw new Error('Duas cartas na mesma zona do treino.');
      occupied.add(key);
    }
    const target = decks[card.player];
    const pile = target.main.includes(card.code) ? target.main : target.extra;
    const index = pile.indexOf(card.code);
    if (index < 0) throw new Error(`Cópia inexistente no cenário: ${card.code}.`);
    pile.splice(index, 1);
  }
  deckAfterOpeningHand(decks[0], lesson.startingHand, 5);
  return { playerDeck: decks[0], opponentDeck: decks[1], scenario,
    openingHands: [lesson.startingHand, decks[1].main.slice(0, 5)] as [number[], number[]] };
}
