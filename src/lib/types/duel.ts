import type { DuelDeckPayload } from "./deck";

/**
 * Formatos de duelo que o app joga.
 *
 * - `goat` — abril de 2005, o formato com que o app nasceu (pool fechado, regras
 *   da época).
 * - `tcg` — o TCG de hoje: pool inteiro e Master Rule 2020 (a regra vigente, a
 *   mesma do EDOPro).
 *
 * Os dois convivem: os decks salvos antes do TCG continuam Goat, e o formato
 * de um deck decide as regras do duelo, o pool do construtor e a banlist que
 * aparece (só como informação — ver `deck-rules.ts`).
 */
export type DuelFormat = "goat" | "tcg";

/** Formato de um deck salvo antes de o campo existir. */
export const DEFAULT_FORMAT: DuelFormat = "goat";

/**
 * Regras de um formato — o que é nosso de decidir: a construção de deck e os
 * números do duelo. As regras de JOGO (Damage Step, zonas, prioridade) moram
 * no core e são escolhidas pela flag do `OcgDuelMode` (`duel-session.ts`).
 */
export interface FormatRules {
  format: DuelFormat;
  /** Nome curto para a interface. */
  label: string;
  /** Master Rule do core (0 = o modo Goat próprio). */
  masterRule: number;
  startingLp: 8000;
  startingHandSize: 5;
  drawPerTurn: 1;
  /** Quem começa compra na Draw Phase do primeiro turno? */
  firstTurnDraw: boolean;
  minMainDeck: 40;
  maxMainDeck: 60;
  maxExtraDeck: number;
  maxSideDeck: 15;
}

/**
 * Goat Format (abril de 2005), conferido contra goatformat.com.
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
 * SIX_STEP_BATLLE_STEP — verificadas).
 */
const GOAT_RULES: FormatRules = {
  format: "goat",
  label: "Goat (2005)",
  masterRule: 0,
  startingLp: 8000,
  startingHandSize: 5,
  drawPerTurn: 1,
  firstTurnDraw: true,
  minMainDeck: 40,
  maxMainDeck: 60,
  // Em 2005 o Fusion Deck não tinha limite — 15 é regra moderna, não Goat.
  maxExtraDeck: 60,
  maxSideDeck: 15,
};

/**
 * TCG de hoje, Master Rule 2020 (`OcgDuelMode.MODE_MR5`): Zonas de Monstro
 * Extra, Pêndulo nas pontas da fileira de magias, sem compra no primeiro
 * turno, Extra Deck de até 15.
 */
const TCG_RULES: FormatRules = {
  format: "tcg",
  label: "TCG",
  masterRule: 5,
  startingLp: 8000,
  startingHandSize: 5,
  drawPerTurn: 1,
  firstTurnDraw: false,
  minMainDeck: 40,
  maxMainDeck: 60,
  maxExtraDeck: 15,
  maxSideDeck: 15,
};

export const FORMAT_RULES: Record<DuelFormat, FormatRules> = {
  goat: GOAT_RULES,
  tcg: TCG_RULES,
};

/** Formato de um valor qualquer (deck salvo, mensagem da rede) — Goat se faltar. */
export function formatOf(value: unknown): DuelFormat {
  return value === "tcg" ? "tcg" : DEFAULT_FORMAT;
}

/** Regras do Goat — atalho para o código que ainda só conhece esse formato. */
export const GOAT_FORMAT_RULES = GOAT_RULES;
/** @deprecated use `FormatRules`. */
export type GoatFormatRules = FormatRules;

/** Configuração mínima para iniciar um duelo — expandida quando integrarmos ocgcore-wasm. */
export interface DuelSetup {
  rules: FormatRules;
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
