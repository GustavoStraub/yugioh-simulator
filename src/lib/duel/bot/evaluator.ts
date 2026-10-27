import type { BotContext } from "@/lib/duel/bot/bot-brain";
import type { BotRoute } from "@/lib/duel/bot/deck-profile";
import type { BotPolicy } from "@/lib/duel/bot/difficulty";
import type { BotHypothesis } from "@/lib/duel/bot/knowledge";
import { readIntel } from "@/lib/duel/bot/card-intel";
import { effectModel, knownInteraction, responsePlace } from "@/lib/duel/bot/effect-model";
import { OcgMessageType as M, OcgResponseType as R, OcgLocation as L, SelectIdleCMDAction as A, type OcgResponse } from "@n1xx1/ocgcore-wasm";

/** Hipóteses qualitativas: a mão oculta nunca é tratada como resposta certa. */
export function responseHypotheses(ctx: BotContext): BotHypothesis[] {
  const foe = ctx.readBoard(false).players[1 - ctx.me];
  const result: BotHypothesis[] = [];
  for (const fact of ctx.strategy === "stable" ? [] : ctx.observedFacts ?? []) {
    if (fact.player === ctx.me || !knownInteraction(fact.code)) continue;
    result.push({ kind: "hand-response", evidence: `Carta ${fact.code} revelada no turno ${fact.seenTurn}`,
      confidence: responsePlace(fact.place, fact.player) ? "known" : "seen" });
  }
  if (foe.spells.some((c) => c?.faceDown)) result.push({ kind: "battle-response", evidence: "Magia/Armadilha baixada", confidence: "possible" });
  if (ctx.format === "tcg" && foe.hand.length > 0) result.push({ kind: "hand-response", evidence: "Adversário tem cartas na mão no TCG", confidence: "possible" });
  return result;
}

/** Consequências dos modelos cobertos, não uma simulação/clonagem do core. */
export function evaluateRoute(route: BotRoute, ctx: BotContext, policy: BotPolicy) {
  const mine = ctx.readBoard(true).players[ctx.me];
  const r = route.result;
  const components: Record<string, number> = { routePrior: 110, pressure: r.pressure / 100, interaction: r.interaction * 12 };
  if (policy.preserveResources) {
    components.continuation = r.continuation * 9;
    components.cost = -r.cost * 10;
    components.reserves = route.reserves.filter(code => mine.hand.some(c => c.code === code)).length * 8;
    // Se o material está na mão, custa continuação em vez de uma carta do Deck.
    components.materialInHand = -6 * route.requires.filter(requirement => requirement.zone === "deck"
      && mine.hand.some(c => c.code === requirement.code)).length;
  }
  const hypotheses = policy.considerResponses ? responseHypotheses(ctx) : [];
  if (hypotheses.length) components.exposure = -r.exposure * (ctx.strategy === "stable" ? hypotheses.length*5
    : Math.max(...hypotheses.map(h => h.confidence === "known" ? 12 : h.confidence === "seen" ? 6 : 3)));
  const life = ctx.lifePoints[ctx.me];
  const foe = ctx.readBoard(false).players[1 - ctx.me];
  const pressure = foe.monsters.reduce((sum, c) => sum + (c && !c.defense ? c.attack ?? 0 : 0), 0);
  if (pressure >= life) components.survival = r.interaction * 15;
  const score = Object.values(components).reduce((sum,n) => sum+n,0);
  return { id: route.id, score, components, reason: policy.considerResponses
    ? `Interação, continuação e ${hypotheses.length} resposta(s) plausível(is)`
    : policy.preserveResources ? "Resultado da rota, custos e recursos preservados" : "Rota principal disponível" };
}

/** Uma leitura compartilhada de recursos próprios e pressão pública, sem simular efeitos desconhecidos. */
export function evaluatePosition(ctx: BotContext, starters: readonly number[] = []) {
  const board = ctx.readBoard(true), mine = board.players[ctx.me], foe = board.players[1 - ctx.me];
  const attackers = foe.monsters.filter(c => c && !c.faceDown && !c.defense);
  const incoming = attackers.reduce((sum,c) => sum + (c?.attack ?? 0), 0);
  const defense = Math.max(0, ...mine.monsters.map(c => !c ? 0 : c.defense ? c.defenseValue ?? 0 : c.attack ?? 0));
  const strongest = Math.max(0, ...attackers.map(c => c?.attack ?? 0));
  const pressure = mine.monsters.reduce((sum,c) => sum + (c && !c.faceDown && !c.defense ? c.attack ?? 0 : 0), 0);
  const access = mine.hand.filter(c => c.code && starters.includes(c.code));
  const interactions = [...mine.hand, ...mine.monsters, ...mine.spells].filter(c => c?.code && !c.negated && knownInteraction(c.code)).length;
  const recovery = ctx.prompt.type === M.SELECT_IDLECMD ? ctx.prompt.activates.filter(c => c.location === L.GRAVE
    && ["search", "recovery"].includes(effectModel(c.code, c.description)?.kind ?? "")).length : 0;
  return { incoming, defense, pressure, strongest, interactions, engineAccess: access.length,
    recovery,
    danger: incoming >= ctx.lifePoints[ctx.me] || strongest > defense,
    stable: defense > strongest && interactions > 0 && mine.monsters.some(Boolean) && (access.length > 0 || recovery > 0) };
}

/** Ajustes marginais: os números editoriais não substituem as consequências visíveis. */
export function actionValue(ctx: BotContext, response: OcgResponse, starters: readonly number[]) {
  const parts: Record<string, number> = {};
  if (ctx.prompt.type !== M.SELECT_IDLECMD || response.type !== R.SELECT_IDLECMD) return parts;
  const p = ctx.prompt, state = evaluatePosition(ctx, starters), mine = ctx.readBoard(true).players[ctx.me];
  const stop = response.action === A.TO_EP || response.action === A.TO_BP;
  if (stop) { parts.preserve = state.stable && !state.danger ? 110 : 0; return parts; }
  if (response.index === null) return parts;
  const cards = response.action === A.SELECT_SUMMON ? p.summons : response.action === A.SELECT_SPECIAL_SUMMON ? p.special_summons
    : response.action === A.SELECT_ACTIVATE ? p.activates : [];
  const card = cards[response.index];
  if (!card) return parts;
  const intel = readIntel(card.code, ctx.cardDb);
  const model = effectModel(card.code, "description" in card ? card.description as bigint : undefined);
  if (response.action === A.SELECT_ACTIVATE && intel.isSpell
    && mine.monsters.some(c => c?.code === 26964762 && !c.negated && !c.faceDown)) parts.restriction = -1000;
  if (response.action === A.SELECT_SUMMON && !starters.includes(card.code)
    && p.summons.some(c => starters.includes(c.code))) parts.normalOpportunity = -45;
  const development = response.action === A.SELECT_SUMMON || response.action === A.SELECT_SPECIAL_SUMMON;
  if (development && card.location === L.HAND && state.stable && !state.danger) parts.extensionCost = -40;
  const tributePressure = response.action === A.SELECT_SUMMON ? mine.monsters.filter(c=>c&&!c.defense&&!c.faceDown)
    .map(c=>c!.attack??0).sort((a,b)=>b-a).slice(0,intel.tributes).reduce((sum,n)=>sum+n,0) : 0;
  if (response.action === A.SELECT_SUMMON && p.to_bp && ctx.readBoard(false).players[1-ctx.me].monsters.every(c => !c)
    && state.pressure < ctx.lifePoints[1-ctx.me] && state.pressure - tributePressure + intel.atk >= ctx.lifePoints[1-ctx.me]) parts.lethal = 240;
  if (model?.kind === "boost" && state.stable && !state.danger) parts.lowImpact = -30;
  if (development && state.incoming >= ctx.lifePoints[ctx.me] && intel.atk > state.strongest) parts.survival = 35;
  return parts;
}

/** Valor marginal de conservar uma carta para a rota ou para o próximo turno. */
export function resourceValue(code: number, ctx: BotContext, reserves: readonly number[], starters: readonly number[]): number {
  const hand = ctx.readBoard(true).players[ctx.me].hand;
  const copies = hand.filter((c) => c.code === code).length;
  const intel = readIntel(code, ctx.cardDb);
  let value = intel.isMonster ? Math.max(intel.atk, intel.def) : 1200;
  if (ctx.strategy !== "stable" && knownInteraction(code)) value += 2000;
  if (reserves.includes(code) && copies <= 1) value += 6000;
  if (starters.includes(code) && copies <= 1) value += 4000;
  if (copies > 1) value -= 600;
  return value;
}
