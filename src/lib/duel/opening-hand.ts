import type { DuelDeckPayload } from "@/lib/types";

/** Retira cada cópia da pilha antes de colocá-la na mão do exercício. */
export function deckAfterOpeningHand(deck: DuelDeckPayload, hand: readonly number[], size: number): DuelDeckPayload {
  if (hand.length !== size) throw new Error(`A mão preparada precisa de ${size} cartas.`);
  const main = [...deck.main];
  for (const code of hand) {
    const index = main.indexOf(code);
    if (index < 0) throw new Error(`A mão preparada usa uma cópia inexistente da carta ${code}.`);
    main.splice(index, 1);
  }
  return { ...deck, main };
}
