import type { DuelDeckPayload } from "@/lib/types";

export const DUEL_SETUP_STORAGE_KEY = "yugioh-goat-duel-setup-v1";

export interface StoredDuelSetup {
  playerName: string;
  playerDeck: DuelDeckPayload;
  opponentId: string;
  opponentName: string;
  opponentDeck: DuelDeckPayload;
}

export function saveDuelSetup(setup: StoredDuelSetup): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(DUEL_SETUP_STORAGE_KEY, JSON.stringify(setup));
}

export function loadDuelSetup(): StoredDuelSetup | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = sessionStorage.getItem(DUEL_SETUP_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredDuelSetup;
  } catch {
    return null;
  }
}

export function clearDuelSetup(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(DUEL_SETUP_STORAGE_KEY);
}
