import type { Passcode } from "./card";
import type { DuelFormat } from "./duel";

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
  /**
   * Formato do deck: decide o pool do construtor, os limites, a banlist que
   * aparece e as regras do duelo. Deck salvo antes do TCG não tem o campo e é
   * Goat (`formatOf`).
   */
  format: DuelFormat;
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
  /**
   * Formato do deck. Viaja junto do deck (duelo local, entrada na sala online,
   * troca de deck) para o duelo saber as regras sem um campo à parte em cada
   * mensagem. Ausente = Goat.
   */
  format?: DuelFormat;
}
