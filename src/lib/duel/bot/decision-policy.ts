import { OcgLocation, SelectIdleCMDAction, type OcgCardLoc, type OcgMessageSelectIdlecmd } from "@n1xx1/ocgcore-wasm";

import type { BoardPlayer, BoardState } from "@/lib/duel/board-state";
import { remainingInDeck } from "@/lib/duel/bot/deck-profile";
import type { GuideDecision, GuideDecisionSignal } from "@/lib/domain/deck-guide";
import type { DuelDeckPayload } from "@/lib/types";

function count(cards: readonly (OcgCardLoc | { code: number | null } | null)[], code: number): number {
  return cards.filter((card) => card?.code === code).length;
}

function visibleCount(signal: GuideDecisionSignal, mine: BoardPlayer, foe: BoardPlayer, deck: DuelDeckPayload): number {
  switch (signal.zone) {
    case "hand": return count(mine.hand, signal.code);
    case "grave": return count(mine.grave, signal.code);
    case "monsters": return count(mine.monsters, signal.code);
    case "main-monsters": return count(mine.monsters.slice(0, 5), signal.code);
    case "extra": return count(mine.extra, signal.code);
    case "deck": return remainingInDeck(deck, mine, signal.code);
    case "own-hand": return mine.hand.length;
    case "own-monsters": return mine.monsters.filter(Boolean).length;
    case "opponent-monsters": return foe.monsters.filter(Boolean).length;
    case "own-main-monsters": return mine.monsters.slice(0, 5).filter(Boolean).length;
    case "own-field-cards": {
      const field = mine.field;
      return mine.monsters.filter(Boolean).length + mine.spells.filter(Boolean).length
        + (field && !mine.spells.some((card) => card?.code === field.code && card?.sequence === field.sequence) ? 1 : 0);
    }
  }
}

/** Avalia apenas cartas próprias e zonas públicas; nunca consulta a mão ou o Deck adversário. */
export function decisionApplies(decision: GuideDecision, board: BoardState, me: 0 | 1, deck: DuelDeckPayload): boolean {
  if (!decision.botEligible) return false;
  const mine = board.players[me];
  const foe = board.players[1 - me];
  return decision.signals.every((signal) => {
    const n = visibleCount(signal, mine, foe, deck);
    if ("code" in signal) return signal.present ? n > 0 : n === 0;
    return n >= (signal.minCount ?? 0) && n <= (signal.maxCount ?? Infinity);
  });
}

export interface DecisionMove {
  decision: GuideDecision;
  action: SelectIdleCMDAction;
  index: number;
  card: OcgCardLoc;
  targetCode?: number;
}

/** O motor continua sendo a autoridade sobre legalidade: só ações oferecidas recebem preferência. */
export function decisionMoves(
  decisions: readonly GuideDecision[], board: BoardState, me: 0 | 1,
  deck: DuelDeckPayload, prompt: OcgMessageSelectIdlecmd,
): DecisionMove[] {
  const moves: DecisionMove[] = [];
  for (const decision of decisions) {
    if (!decisionApplies(decision, board, me, deck)) continue;
    const chosen = decision.choices[decision.correctChoice]?.action;
    if (!chosen || chosen.kind === "hold") continue;
    const list = chosen.kind === "summon"
      ? chosen.mode === "normal" ? prompt.summons : prompt.special_summons
      : prompt.activates;
    const index = list.findIndex((card) => card.code === chosen.code
      && (chosen.mode !== "link" || card.location === OcgLocation.EXTRA)
      && (chosen.mode !== "special" || card.location === OcgLocation.HAND));
    if (index < 0) continue;
    moves.push({ decision, action: chosen.kind === "summon"
      ? chosen.mode === "normal" ? SelectIdleCMDAction.SELECT_SUMMON : SelectIdleCMDAction.SELECT_SPECIAL_SUMMON
      : SelectIdleCMDAction.SELECT_ACTIVATE,
    index, card: list[index], targetCode: chosen.targetCode });
  }
  return moves;
}

/** Guardar é uma sugestão comparável; outras ações ainda podem evitar derrota ou produzir vitória. */
export function decisionHolds(decisions: readonly GuideDecision[], board: BoardState, me: 0 | 1, deck: DuelDeckPayload) {
  return decisions.filter(decision => decisionApplies(decision, board, me, deck)
    && decision.choices[decision.correctChoice]?.action?.kind === "hold");
}

/** Uma decisão do guia também pode orientar o alvo de um efeito já em resolução. */
export function decisionEffectTarget(
  decisions: readonly GuideDecision[], board: BoardState, me: 0 | 1,
  deck: DuelDeckPayload, effectCode: number, candidates: readonly OcgCardLoc[],
): { decision: GuideDecision; index: number } | null {
  for (const decision of decisions) {
    if (!decisionApplies(decision, board, me, deck)) continue;
    const action = decision.choices[decision.correctChoice]?.action;
    if (action?.kind !== "effect" || action.code !== effectCode || !action.targetCode) continue;
    const index = candidates.findIndex((card) => card.controller === me && card.code === action.targetCode);
    if (index >= 0) return { decision, index };
  }
  return null;
}

/**
 * Busca uma continuação de duas ações sem presumir o resultado de efeitos.
 * Só projetamos a mudança certa de uma Invocação da mão: a carta sai da mão
 * e entra na zona principal. A segunda ação continua sujeita ao prompt real.
 */
export function sequenceFollowUp(
  decisions: readonly GuideDecision[], board: BoardState, me: 0 | 1,
  deck: DuelDeckPayload, first: SelectIdleCMDAction, card: OcgCardLoc,
): GuideDecision | null {
  if (card.controller !== me || card.location !== OcgLocation.HAND
    || (first !== SelectIdleCMDAction.SELECT_SUMMON && first !== SelectIdleCMDAction.SELECT_SPECIAL_SUMMON)) return null;
  const mine = board.players[me];
  const foe = board.players[1 - me];
  if (mine.monsters.slice(0, 5).every(Boolean)) return null;
  const remaining = [...mine.hand];
  const moved = remaining.findIndex((held) => held.code === card.code);
  if (moved < 0) return null;
  remaining.splice(moved, 1);

  const projectedCount = (signal: GuideDecisionSignal): number => {
    const before = visibleCount(signal, mine, foe, deck);
    if (signal.zone === "hand") return before - Number(signal.code === card.code);
    if (signal.zone === "monsters" || signal.zone === "main-monsters") return before + Number(signal.code === card.code);
    if (signal.zone === "own-hand") return before - 1;
    if (signal.zone === "own-monsters" || signal.zone === "own-main-monsters" || signal.zone === "own-field-cards") return before + 1;
    return before;
  };

  for (const decision of decisions) {
    if (!decision.botEligible || decisionApplies(decision, board, me, deck)) continue;
    const action = decision.choices[decision.correctChoice]?.action;
    const follows = action?.kind === "effect" && action.code === card.code && action.targetCode
      ? remaining.some((held) => held.code === action.targetCode)
      : action?.kind === "summon" && action.mode === "normal" && first === SelectIdleCMDAction.SELECT_SPECIAL_SUMMON
        ? remaining.some((held) => held.code === action.code)
        : action?.kind === "summon" && action.mode === "special" && first === SelectIdleCMDAction.SELECT_SUMMON
          ? remaining.some((held) => held.code === action.code)
          : false;
    if (!follows) continue;
    if (decision.signals.every((signal) => {
      const n = projectedCount(signal);
      return "code" in signal ? signal.present ? n > 0 : n === 0
        : n >= (signal.minCount ?? 0) && n <= (signal.maxCount ?? Infinity);
    })) return decision;
  }
  return null;
}
