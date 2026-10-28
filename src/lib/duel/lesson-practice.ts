import { OcgMessageType } from "@n1xx1/ocgcore-wasm";

import type { GuideCardTarget, PracticeGuideLesson, PracticeCondition } from "@/lib/domain/deck-guide";
import type { DuelSnapshot } from "@/lib/duel/duel-session";
import { buildPromptPlan } from "@/lib/duel/duel-actions";

export function practiceConditionMet(condition: PracticeCondition, snapshot: DuelSnapshot): boolean {
  if (condition.kind === "lp") return snapshot.lifePoints[condition.player] === condition.value;
  const player = snapshot.boards[0]?.players[0];
  if (!player) return false;
  if (condition.kind === "card") {
    const cards = condition.zone === "field" ? [player.field] : player[condition.zone];
    const count = cards.filter((card) => card?.code === condition.code && (condition.attack === undefined || card.attack === condition.attack)).length;
    return condition.absent ? count === 0 : count >= (condition.count ?? 1);
  }
  const prompt = snapshot.pendingPrompt;
  if (!prompt || snapshot.promptPlayer !== 0) return false;
  const cards = prompt.type === OcgMessageType.SELECT_CARD ? prompt.selects
    : prompt.type === OcgMessageType.SELECT_UNSELECT_CARD ? prompt.select_cards : [];
  return cards.some((card) => card.code === condition.code && card.location === condition.location);
}

export interface PracticeState { reached: number; completed: boolean; ended: boolean }
export const EMPTY_PRACTICE: PracticeState = { reached: 0, completed: false, ended: false };

/** Recomenda somente cartas desta etapa que o motor oferece neste momento. */
export function practiceCardTargets(lesson: PracticeGuideLesson, snapshot: DuelSnapshot, practice: PracticeState): GuideCardTarget[] {
  if (practice.completed || practice.ended || snapshot.isProcessing || snapshot.promptPlayer !== 0 || !snapshot.pendingPrompt) return [];
  const stage = lesson.practice.stages[practice.reached];
  if (!stage) return [];
  const plan = buildPromptPlan(snapshot.pendingPrompt);
  const offered: GuideCardTarget[] = [...(plan.selection?.candidates ?? [])];
  for (const [key, actions] of plan.byCard) {
    const controller = Number(key.split(":")[0]);
    for (const action of actions) offered.push({ code: action.code, location: action.location, controller });
  }
  if (plan.subject) offered.push({ ...plan.subject, controller: 0 });
  return stage.targets.filter((target) => (target.scope !== "action" || !plan.selection)
    && (target.scope !== "selection" || Boolean(plan.selection))
    && offered.some((card) => card.code > 0 && card.code === target.code
    && card.location === target.location && (card.controller ?? 0) === (target.controller ?? 0)));
}

/** Avança somente com evidências do motor. Clicar numa dica não conclui etapas. */
export function advancePractice(lesson: PracticeGuideLesson, snapshot: DuelSnapshot, previous: PracticeState): PracticeState {
  if (previous.completed || previous.ended) return previous;
  const stable = !snapshot.isProcessing && snapshot.pendingPrompt?.type === OcgMessageType.SELECT_IDLECMD
    && snapshot.promptPlayer === 0 && snapshot.chainLinks.length === 0;
  const completed = stable && snapshot.turnCount === 1
    && lesson.practice.goal.every((condition) => practiceConditionMet(condition, snapshot));
  let reached = previous.reached;
  while (reached < lesson.practice.stages.length && lesson.practice.stages[reached].completeWhen.every((condition) => practiceConditionMet(condition, snapshot))) reached += 1;
  return { reached: completed ? lesson.practice.stages.length : reached, completed, ended: !completed && (snapshot.turnCount > 1 || snapshot.winner !== null) };
}

