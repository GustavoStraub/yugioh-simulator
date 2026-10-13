import {
  OcgLocation,
  OcgResponseType,
  SelectIdleCMDAction,
  type OcgResponse,
  type SelectFieldPlace,
} from "@n1xx1/ocgcore-wasm";

import { PENDULUM_SCALE_DETAIL } from "@/lib/duel/duel-actions";

/**
 * Zona escolhida ANTES do comando — o que deixa desistir de uma invocação.
 *
 * O core não tem volta na escolha de zona: `SelectPlace` (e `SelectPosition`)
 * só aceitam uma zona válida ou respondem RETRY — não existe o "-1 = desisto"
 * que a escolha de tributos e várias seleções de carta aceitam (conferido em
 * `playerop.cpp` do ygopro-core). Antes, clicar "Invocar" mandava o comando na
 * hora, o core perguntava a zona, e dali não havia saída: quem clicou errado
 * invocava assim mesmo.
 *
 * O Master Duel resolve isso com a zona escolhida junto do comando (arrastar a
 * carta para a zona). Aqui é o mesmo: "Invocar" abre a escolha de zona SEM
 * falar com o core; "Cancelar" só fecha a escolha (nada foi enviado); clicar
 * numa zona manda o comando e, quando o core pergunta a zona, a resposta já é
 * a escolhida (`placeResponseFor`).
 *
 * Só vale onde o conjunto de zonas é previsível pela mesa — caso contrário a
 * pergunta voltaria depois, e o jogador escolheria duas vezes:
 *
 * - Invocar / Baixar (monstro) de um monstro de Nível 4 ou menos da mão: vai
 *   para uma Zona de Monstro principal livre (0–4). Nível 5+ pede tributo, e
 *   o tributo libera zona — a pergunta fica para depois dele, como antes (e
 *   a escolha de tributos já tem "Cancelar invocação").
 * - Baixar uma Magia/Armadilha da mão: Zona de Magia/Armadilha livre (0–4). A
 *   Magia de Campo vai sozinha para a Zona de Campo — o core não pergunta.
 * - Ativar uma Magia/Armadilha da mão (não de Campo): também ocupa uma Zona de
 *   Magia/Armadilha livre. Como Escala de Pêndulo: só as zonas 0 e 4.
 *
 * Fora disso (Invocação-Especial, efeito de monstro na mão, carta do campo)
 * a jogada segue direto para o core, como sempre foi.
 */
export interface ZoneFirstCard {
  /** Rótulo da jogada (`CardAction.label`). */
  label: string;
  /** O efeito descrito pelo core, quando há (`CardAction.detail`). */
  detail?: string;
  response: OcgResponse;
  /** Onde a carta está. */
  location: number;
  /** Nível impresso (0 ou ausente quando não é monstro). */
  level?: number | null;
  /** Tipo da carta, como o catálogo o escreve ("Spell Card", "Field Spell"…). */
  kind: "monster" | "spell" | "trap" | "other";
  isFieldSpell: boolean;
  isPendulum: boolean;
}

/** As zonas do jogador `seat`: ocupada? inutilizada por efeito? */
export interface ZoneFirstBoard {
  seat: 0 | 1;
  monsters: (unknown | null)[];
  spells: (unknown | null)[];
  isDisabled: (player: 0 | 1, location: number, sequence: number) => boolean;
}

function idleAction(response: OcgResponse): number | null {
  if (response.type !== OcgResponseType.SELECT_IDLECMD) return null;
  return (response as { action: number }).action;
}

/** Zonas livres de uma fileira, nas sequências pedidas. */
function livres(
  board: ZoneFirstBoard,
  location: OcgLocation,
  ocupadas: (unknown | null)[],
  sequences: number[],
): SelectFieldPlace[] {
  return sequences
    .filter((sequence) => !ocupadas[sequence] && !board.isDisabled(board.seat, location, sequence))
    .map((sequence) => ({ player: board.seat, location, sequence }));
}

const PRINCIPAIS = [0, 1, 2, 3, 4];
const ESCALAS = [0, 4];

/**
 * As zonas que a jogada vai ocupar, quando dá para escolher antes do comando
 * — ou `null`, quando a jogada deve seguir direto para o core.
 *
 * Com uma zona só (ou nenhuma) também é `null`: não há o que escolher, e o
 * core (ou a resposta automática) resolve sozinho, como antes.
 */
export function zonesBeforeCommand(
  card: ZoneFirstCard,
  board: ZoneFirstBoard,
): SelectFieldPlace[] | null {
  if (card.location !== OcgLocation.HAND) return null;
  const action = idleAction(card.response);
  if (action === null) return null;

  let zonas: SelectFieldPlace[] = [];
  if (
    action === SelectIdleCMDAction.SELECT_SUMMON ||
    action === SelectIdleCMDAction.SELECT_MONSTER_SET
  ) {
    if (card.kind !== "monster") return null;
    const nivel = card.level ?? 0;
    if (nivel < 1 || nivel > 4) return null;
    zonas = livres(board, OcgLocation.MZONE, board.monsters, PRINCIPAIS);
  } else if (action === SelectIdleCMDAction.SELECT_SPELL_SET) {
    if ((card.kind !== "spell" && card.kind !== "trap") || card.isFieldSpell) return null;
    zonas = livres(board, OcgLocation.SZONE, board.spells, PRINCIPAIS);
  } else if (action === SelectIdleCMDAction.SELECT_ACTIVATE) {
    const comoEscala = card.isPendulum && card.detail === PENDULUM_SCALE_DETAIL;
    if (comoEscala) {
      zonas = livres(board, OcgLocation.SZONE, board.spells, ESCALAS);
    } else if ((card.kind === "spell" || card.kind === "trap") && !card.isFieldSpell) {
      zonas = livres(board, OcgLocation.SZONE, board.spells, PRINCIPAIS);
    } else {
      return null;
    }
  } else {
    return null;
  }

  return zonas.length > 1 ? zonas : null;
}

/**
 * Quando o core pergunta a zona (SELECT_PLACE de 1 zona), a resposta que
 * corresponde à zona escolhida antes — ou `null`, se ela não estiver entre as
 * oferecidas (aí o jogador escolhe de novo, que é melhor que travar).
 */
export function placeResponseFor<T extends { place: SelectFieldPlace; response: OcgResponse }>(
  offered: T[],
  chosen: SelectFieldPlace,
): OcgResponse | null {
  const match = offered.find(
    ({ place }) =>
      place.player === chosen.player &&
      place.location === chosen.location &&
      place.sequence === chosen.sequence,
  );
  return match?.response ?? null;
}
