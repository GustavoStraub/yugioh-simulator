import type { BotContext } from "@/lib/duel/bot/bot-brain";
import type { BotRoute } from "@/lib/duel/bot/deck-profile";
import type { BotPolicy } from "@/lib/duel/bot/difficulty";
import type { BotHypothesis } from "@/lib/duel/bot/knowledge";
import { readIntel } from "@/lib/duel/bot/card-intel";

/** Hipóteses qualitativas: a mão oculta nunca é tratada como resposta certa. */
export function responseHypotheses(ctx: BotContext): BotHypothesis[] {
  const foe = ctx.readBoard(false).players[1 - ctx.me];
  const result: BotHypothesis[] = [];
  if (foe.spells.some((c) => c?.faceDown)) result.push({ kind: "battle-response", evidence: "Magia/Armadilha baixada", confidence: "possible" });
  if (ctx.format === "tcg" && foe.hand.length > 0) result.push({ kind: "hand-response", evidence: "Adversário tem cartas na mão no TCG", confidence: "possible" });
  return result;
}

/** Consequências dos modelos cobertos, não uma simulação/clonagem do core. */
export function evaluateRoute(route: BotRoute, ctx: BotContext, policy: BotPolicy) {
  const mine = ctx.readBoard(true).players[ctx.me];
  const r = route.result;
  let score = 110 + r.pressure / 100 + r.interaction * 12;
  if (policy.preserveResources) {
    score += r.continuation * 9 - r.cost * 10;
    for (const code of route.reserves) if (mine.hand.some((c) => c.code === code)) score += 8;
    // Se o material está na mão, custa continuação em vez de uma carta do Deck.
    for (const requirement of route.requires) if (requirement.zone === "deck"
      && mine.hand.some((c) => c.code === requirement.code)) score -= 6;
  }
  const hypotheses = policy.considerResponses ? responseHypotheses(ctx) : [];
  if (hypotheses.length) score -= r.exposure * hypotheses.length * 5;
  const life = ctx.lifePoints[ctx.me];
  const foe = ctx.readBoard(false).players[1 - ctx.me];
  const pressure = foe.monsters.reduce((sum, c) => sum + (c && !c.defense ? c.attack ?? 0 : 0), 0);
  if (pressure >= life) score += r.interaction * 15;
  return { id: route.id, score, reason: policy.considerResponses
    ? `Interação, continuação e ${hypotheses.length} resposta(s) plausível(is)`
    : policy.preserveResources ? "Resultado da rota, custos e recursos preservados" : "Rota principal disponível" };
}

/** Valor marginal de conservar uma carta para a rota ou para o próximo turno. */
export function resourceValue(code: number, ctx: BotContext, reserves: readonly number[], starters: readonly number[]): number {
  const hand = ctx.readBoard(true).players[ctx.me].hand;
  const copies = hand.filter((c) => c.code === code).length;
  const intel = readIntel(code, ctx.cardDb);
  let value = intel.isMonster ? Math.max(intel.atk, intel.def) : 1200;
  if (reserves.includes(code) && copies <= 1) value += 6000;
  if (starters.includes(code) && copies <= 1) value += 4000;
  if (copies > 1) value -= 600;
  return value;
}
