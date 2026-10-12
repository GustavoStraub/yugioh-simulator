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
