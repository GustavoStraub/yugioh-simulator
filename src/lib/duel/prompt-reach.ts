import { OcgLocation } from "@n1xx1/ocgcore-wasm";

import type { SelectionCandidate } from "@/lib/duel/duel-actions";

/**
 * Onde uma carta pode ser clicada direto no tabuleiro.
 *
 * A mão entra com ressalva: a **do oponente** é desenhada como versos, sem
 * zona clicável nenhuma. Ela é "visível" (dá para contar as cartas) e não é
 * alcançável — a distinção que falta aqui é a que trava o duelo.
 */
const ZONAS_NA_MESA = new Set<number>([
  OcgLocation.MZONE,
  OcgLocation.SZONE,
  OcgLocation.HAND,
]);

/** O jogador consegue clicar neste candidato no próprio tabuleiro? */
export function isCandidateOnBoard(
  candidate: Pick<SelectionCandidate, "location" | "controller">,
  viewer: 0 | 1,
): boolean {
  if (!ZONAS_NA_MESA.has(candidate.location)) return false;
  if (candidate.location === OcgLocation.HAND) return candidate.controller === viewer;
  return true;
}

/**
 * A seleção precisa do seletor em modal?
 *
 * Basta **um** candidato fora de alcance: busca no Deck, alvo no Cemitério ou
 * uma carta na mão do oponente (Confisco, Dupla Delinquente, Armadilha Poeira,
 * Sentinela Poderosa). Sem o modal, esses prompts abriam a barra de seleção
 * com nada para marcar e o duelo parava ali, sem erro nenhum na tela.
 */
export function needsCardPicker(
  candidates: readonly Pick<SelectionCandidate, "location" | "controller">[],
  viewer: 0 | 1,
): boolean {
  return candidates.some((candidate) => !isCandidateOnBoard(candidate, viewer));
}

/**
 * Onde o jogador alcança uma JOGADA (ação de `PromptPlan.byCard`) numa carta:
 *
 * - `board` — na mesa desenhada (mão, monstros, magias/armadilhas);
 * - `pile` — numa pilha que brilha e abre com a carta em destaque (Cemitério,
 *   banidas, Extra Deck): Invocar do Extra Deck, efeito de Cemitério;
 * - `other` — em lugar nenhum desenhado (Deck, material Xyz): a mesa oferece
 *   "Outras jogadas", para nenhuma jogada do engine ficar inalcançável.
 *
 * A mesa agrupa as jogadas por aqui, e o harness confere com a mesma função.
 */
export function actionReach(location: number): "board" | "pile" | "other" {
  if (ZONAS_NA_MESA.has(location)) return "board";
  if (
    location === OcgLocation.GRAVE ||
    location === OcgLocation.REMOVED ||
    location === OcgLocation.EXTRA
  ) {
    return "pile";
  }
  return "other";
}
