import { createEmptyDeck } from "./deck-operations";

import type { DeckList } from "@/lib/types";

export const DECK_STORAGE_KEY = "yugioh-goat-deck-v1";

export function loadDeck(): DeckList {
  if (typeof window === "undefined") return createEmptyDeck();

  try {
    const raw = localStorage.getItem(DECK_STORAGE_KEY);
    if (!raw) return createEmptyDeck();
    return JSON.parse(raw) as DeckList;
  } catch {
    return createEmptyDeck();
  }
}

export function saveDeck(deck: DeckList): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    DECK_STORAGE_KEY,
    JSON.stringify({ ...deck, updatedAt: new Date().toISOString() }),
  );
}
