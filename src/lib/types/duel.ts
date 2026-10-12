import type { DuelDeckPayload } from "./deck";

/**
 * Regras do Goat Format (abril de 2005), conferidas contra goatformat.com.
 *
 * Diferenças em relação ao Yu-Gi-Oh! moderno que valem registrar:
 * - Quem começa **compra** no primeiro turno, ficando com 6 cartas na mão.
 * - Só uma Magia de Campo fica ativa por vez; a nova destrói a anterior.
 * - O jogador do turno tem prioridade para ativar um efeito de **Ignição**
 *   depois de invocar, antes de o oponente responder (regra removida em 2014).
 * - A Damage Step tem **seis** substeps, não cinco.
 * - O Fusion Deck (nosso "extra") **não tinha limite de tamanho**; simuladores
 *   convencionaram capar em 60, e é o que usamos.
 *
 * As quatro primeiras são implementadas pelo próprio `OcgDuelMode.MODE_GOAT`
 * do ocgcore (flags FIRST_TURN_DRAW, ONE_FACEUP_FIELD, OBSOLETE_IGNITION e
 * SIX_STEP_BATLLE_STEP — verificadas). Este objeto cobre o que é nosso: a
 * construção de deck.
 */
export interface GoatFormatRules {
  format: "goat";
  masterRule: 0;
  startingLp: 8000;
  startingHandSize: 5;
  drawPerTurn: 1;
  /** Goat: quem começa compra na Draw Phase (fica com 6 na mão). */
  firstTurnDraw: true;
  maxMainDeck: 60;
  minMainDeck: 40;
  maxExtraDeck: 60;
  maxSideDeck: 15;
}

export const GOAT_FORMAT_RULES: GoatFormatRules = {
  format: "goat",
  masterRule: 0,
  startingLp: 8000,
  startingHandSize: 5,
  drawPerTurn: 1,
  firstTurnDraw: true,
  maxMainDeck: 60,
  minMainDeck: 40,
  // Em 2005 o Fusion Deck não tinha limite — 15 é regra moderna, não Goat.
  maxExtraDeck: 60,
  maxSideDeck: 15,
};

/** Configuração mínima para iniciar um duelo — expandida quando integrarmos ocgcore-wasm. */
export interface DuelSetup {
  rules: GoatFormatRules;
  player1: { name: string; deck: DuelDeckPayload };
  player2: { name: string; deck: DuelDeckPayload };
}

/** Localizações de carta no tabuleiro — base para UI e estado de duelo futuro. */
export const CARD_LOCATIONS = {
  DECK: "deck",
  EXTRA: "extra",
  HAND: "hand",
  MONSTER_ZONE: "monster",
  SPELL_TRAP_ZONE: "spell_trap",
  GRAVEYARD: "graveyard",
  BANISHED: "banished",
  FIELD: "field",
} as const;

export type CardLocation = (typeof CARD_LOCATIONS)[keyof typeof CARD_LOCATIONS];
