import { canAddCard } from "./deck-rules";

import { randomId } from "@/lib/random-id";
import { formatOf } from "@/lib/types";
import type {
  CardDefinition,
  DeckCardRef,
  DeckList,
  DeckZone,
  DuelFormat,
  Passcode,
} from "@/lib/types";

export function createEmptyDeck(name = "Meu Deck Goat", format: DuelFormat = "goat"): DeckList {
  return {
    id: randomId(),
    name,
    format,
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
    ...createEmptyDeck(deck.name, deck.format),
    id: deck.id,
  };
}

/**
 * Deck vindo de fora (servidor, `localStorage`, arquivo antigo) no formato de
 * hoje: sem `format` é Goat — todo deck salvo antes do TCG existir no app.
 */
export function normalizeDeck(deck: DeckList): DeckList {
  const format = formatOf(deck.format);
  return deck.format === format ? deck : { ...deck, format };
}

/** Troca o formato do deck (as cartas ficam; o que sair do pool é avisado). */
export function setDeckFormat(deck: DeckList, format: DuelFormat): DeckList {
  if (deck.format === format) return deck;
  return { ...deck, format, updatedAt: new Date().toISOString() };
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
