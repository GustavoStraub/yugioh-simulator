import type { Passcode } from "./card";

export type DeckZone = "main" | "extra" | "side";

/**
 * Referência mínima a uma carta no deck.
 * Só guarda passcode + quantidade — dados visuais vêm do CardRegistry.
 * Mesmo formato serve para persistência e para montar payload de duelo.
 */
export interface DeckCardRef {
  passcode: Passcode;
  quantity: number;
}

export interface DeckList {
  id: string;
  name: string;
  format: "goat";
  main: DeckCardRef[];
  extra: DeckCardRef[];
  side: DeckCardRef[];
  updatedAt: string;
}

/**
 * Payload plano de passcodes (com repetição) — formato que o ocgcore consome
 * via OCG_DuelNewCard / carregamento de deck.
 */
export interface DuelDeckPayload {
  main: Passcode[];
  extra: Passcode[];
  side: Passcode[];
}
