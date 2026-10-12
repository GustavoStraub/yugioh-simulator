import { canAddCard } from "./deck-rules";

import { randomId } from "@/lib/random-id";
import type { CardDefinition, DeckCardRef, DeckList, DeckZone, Passcode } from "@/lib/types";

export function createEmptyDeck(name = "Meu Deck Goat"): DeckList {
  return {
    id: randomId(),
    name,
    format: "goat",
    main: [],
    extra: [],
    side: [],
    updatedAt: new Date().toISOString(),
  };
}

export function addCardToDeck(
  deck: DeckList,
  card: CardDefinition,
  zone: DeckZone,
): DeckList {
  const check = canAddCard(deck, card, zone);
  if (!check.ok) return deck;

  const next = structuredClone(deck);
  const existing = next[zone].find((ref) => ref.passcode === card.passcode);

  if (existing) {
    existing.quantity += 1;
  } else {
    next[zone].push({ passcode: card.passcode, quantity: 1 });
  }

  next.updatedAt = new Date().toISOString();
  return next;
}

export function removeCardFromDeck(
  deck: DeckList,
  passcode: Passcode,
  zone: DeckZone,
): DeckList {
  const next = structuredClone(deck);
  const index = next[zone].findIndex((ref) => ref.passcode === passcode);
  if (index === -1) return deck;

  const ref = next[zone][index];
  if (ref.quantity > 1) {
    ref.quantity -= 1;
  } else {
    next[zone].splice(index, 1);
  }

  next.updatedAt = new Date().toISOString();
  return next;
}

export function clearDeck(deck: DeckList): DeckList {
  return {
    ...createEmptyDeck(deck.name),
    id: deck.id,
  };
}

export function replaceDeck(deck: DeckList, next: DeckList): DeckList {
  return {
    ...next,
    id: deck.id,
    updatedAt: new Date().toISOString(),
  };
}

/** Expande refs em lista plana de passcodes — formato para ocgcore. */
export function expandDeckZone(refs: DeckCardRef[]): number[] {
  const result: number[] = [];
  for (const ref of refs) {
    for (let i = 0; i < ref.quantity; i += 1) {
      result.push(ref.passcode);
    }
  }
  return result;
}
