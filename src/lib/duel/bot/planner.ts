import { OcgLocation as L, OcgMessageType as M, type OcgCardLoc } from "@n1xx1/ocgcore-wasm";
import type { BotContext } from "@/lib/duel/bot/bot-brain";
import { remainingInDeck, stepHasEffect, type BotCondition, type BotDeckProfile, type BotRoute, type BotStep } from "@/lib/duel/bot/deck-profile";
import type { BotPolicy } from "@/lib/duel/bot/difficulty";
import { evaluateRoute } from "@/lib/duel/bot/evaluator";
import { BotIntentStack } from "@/lib/duel/bot/intent";
import type { DuelDeckPayload } from "@/lib/types";
import type { BotGuideHints } from "@/lib/duel/bot/guide-hints";
import type { BoardPlayer } from "@/lib/duel/board-state";

export class BotPlanner {
  route: BotRoute | null = null;
  stepIndex = 0;
  readonly intents = new BotIntentStack();
  alternatives: { id: string; score: number; reason: string }[] = [];
  reason = "Análise genérica";
  replans = 0;
  private turn = -1;
  private failureRevision = 0;
  private readonly unavailable = new Set<string>();
  private substitutions = new Map<string, { code: number; count: number }>();
  private continuation: number[] = [];
  private lastAttempt = "";
  private repeatedAttempts = 0;

  readonly profile: BotDeckProfile | null;
  readonly guide: BotGuideHints | null;
  private readonly deck: DuelDeckPayload | null;
  constructor(profile: BotDeckProfile | null, deck: DuelDeckPayload | null, guide: BotGuideHints | null = null) {
    this.profile = profile;
    this.deck = deck;
    this.guide = profile ? null : guide;
  }
  get step(): BotStep | null { return this.route?.steps[this.stepIndex] ?? null; }
  get reserves(): number[] {
    if (!this.route) return this.continuation;
    return [...this.route.reserves, ...this.route.steps.slice(this.stepIndex + 1).flatMap((s) => s.action ? [s.action.code] : [])];
  }
  get starters(): number[] { return this.profile?.roles.filter((r) => r.roles.includes("starter")).map((r) => r.code)
    ?? [...(this.guide?.opening ?? [])]; }
  get protectedCards(): readonly number[] { return this.guide?.core ?? []; }

  /** Uma abertura editorial só ganha prioridade quando suas peças observáveis existem. */
  openingReady(code: number, mine: BoardPlayer): boolean {
    if (!this.guide || !this.deck) return false;
    const available = [...mine.hand, ...mine.monsters, ...mine.spells, ...mine.grave];
    return this.guide.plays.some((play) => play.code === code && play.support.every((support) => {
      if (play.zone === "grave") return mine.grave.some((card) => card.code === support);
      if (play.zone === "deck") return remainingInDeck(this.deck!, mine, support) > 0
        || mine.extra.some((card) => card.code === support);
      return available.some((card) => card?.code === support);
    }));
  }

  observe(ctx: BotContext, policy: BotPolicy, deadline: number): void {
    if (this.turn !== ctx.turnCount) {
      this.turn = ctx.turnCount;
      this.unavailable.clear();
      this.route = null;
      this.substitutions.clear();
      this.continuation = [];
      this.intents.clear();
      this.lastAttempt = "";
      this.repeatedAttempts = 0;
    }
    const failed = ctx.failedEffect;
    if (failed && failed.revision !== this.failureRevision) {
      this.failureRevision = failed.revision;
      this.intents.invalidate(failed.code);
      if (failed.player === ctx.me && this.route?.steps.some((s) => s.effects.includes(failed.code))) this.abandon("Efeito da rota negado; recursos reavaliados");
    }
    // Fácil conhece funções, mas resolve escolhas localmente. Somente os
    // níveis que comparam a sequência mantêm reservas e uma rota completa.
    if (!this.profile || !this.deck || !policy.preserveResources) return;
    while (this.step && this.step.completeWhen.every((condition) => this.met(condition, ctx))) this.stepIndex += 1;
    if (this.route && !this.step && !ctx.chainOpen && ctx.prompt.type === M.SELECT_IDLECMD) {
      this.continuation = [...this.route.reserves];
      this.unavailable.add(this.route.id);
      this.reason = "Resultado confirmado pelo campo após a corrente";
      this.route = null;
      this.intents.clear();
    }
    // Uma ação que deixou de ser oferecida não autoriza avançar a receita.
    if (this.route && this.step && ctx.prompt.type === M.SELECT_IDLECMD) {
      const action = this.step.action;
      // Etapas sem `action` aguardam a resolução de um efeito ou uma escolha
      // de material. Não aparecerem em SELECT_IDLECMD não invalida a rota.
      if (action && !ctx.prompt[action.kind].some((c) => c.code === action.code)) this.abandon("Recursos ou ação indisponíveis; procurando alternativa");
    }
    if (this.route || ctx.prompt.type !== M.SELECT_IDLECMD || ctx.turnPlayer !== ctx.me) return;
    const prompt = ctx.prompt;
    const candidates = this.profile.routes.flatMap((route) => {
      if (this.unavailable.has(route.id) || (route.minDifficulty && !policy.considerResponses)) return [];
      const entry = policy.considerResponses ? this.completedPrefix(route, ctx) : 0;
      const action = route.steps[entry]?.action;
      if (!action || !this.canStart(route, ctx, entry)
        || !prompt[action.kind].some((card) => card.code === action.code)) return [];
      return [{ route, entry }];
    });
    this.alternatives = [];
    let best: { route: BotRoute; entry: number } | null = null;
    let bestScore = -Infinity;
    for (const candidate of candidates.slice(0, policy.alternatives)) {
      if (performance.now() >= deadline && best) break;
      const rating = evaluateRoute(candidate.route, ctx, policy);
      this.alternatives.push(rating);
      if (rating.score > bestScore) { best = candidate; bestScore = rating.score; }
    }
    // Parar faz parte da comparação: uma mesa já estabelecida não precisa de
    // uma segunda rota que só consome recursos. O motor pode oferecer mais.
    const board = ctx.readBoard(true);
    const mine = board.players[ctx.me];
    const foe = board.players[1 - ctx.me];
    const established = mine.monsters.some((c) => c?.code && this.profile!.roles.some((r) => r.code === c.code && r.roles.includes("finisher")));
    const myStrongest = Math.max(0, ...mine.monsters.map((c) => c && !c.faceDown
      ? c.defense ? c.defenseValue ?? 0 : c.attack ?? 0 : 0));
    const theirAttacks = foe.monsters.map((c) => c && !c.faceDown && !c.defense ? c.attack ?? 0 : 0);
    const theirStrongest = Math.max(0, ...theirAttacks);
    // Preservar uma mesa pronta é bom enquanto ela segura o campo. Se um
    // atacante visível supera nosso melhor monstro, considerar outra rota.
    const stopScore = established && policy.preserveResources
      ? theirStrongest >= myStrongest ? 60 : 200
      : 0;
    this.alternatives.push({ id: "preservar", score: stopScore, reason: "Preservar defesa e continuação existentes" });
    if (best && bestScore > stopScore) {
      this.route = best.route;
      this.stepIndex = best.entry;
      this.substitutions.clear();
      this.reason = best.entry > 0 ? "Retomando rota a partir do campo confirmado" : "Rota compatível com os recursos conhecidos";
    }
  }

  private completedPrefix(route: BotRoute, ctx: BotContext): number {
    let index = 0;
    while (index < route.steps.length && route.steps[index].completeWhen.length > 0
      && route.steps[index].completeWhen.every((condition) => this.met(condition, ctx))) index += 1;
    return index;
  }

  private canStart(route: BotRoute, ctx: BotContext, entry = 0): boolean {
    const mine = ctx.readBoard(true).players[ctx.me];
    const priorActions = route.steps.slice(0, entry).flatMap((step) => step.action ? [step.action.code] : []);
    if (mine.hand.length < Math.max(0, route.minHand - priorActions.length)) return false;
    return route.requires.every((r) => {
      if (r.zone === "deck") return remainingInDeck(this.deck!, mine, r.code) >= r.count;
      const available = mine[r.zone].filter((c) => c?.code === r.code).length;
      if (r.zone !== "hand" || available >= r.count) return available >= r.count;
      const used = priorActions.filter((code) => code === r.code).length;
      const visible = [...mine.monsters, ...mine.spells, ...mine.grave, ...mine.banished]
        .filter((card) => card?.code === r.code).length;
      return available + Math.min(used, visible) >= r.count;
    });
  }

  private met(condition: BotCondition, ctx: BotContext): boolean {
    if (condition.kind === "lp") return ctx.lifePoints[condition.player === 0 ? ctx.me : 1 - ctx.me] === condition.value;
    if (condition.kind === "offered") {
      const p = ctx.prompt;
      const cards = p.type === M.SELECT_CARD ? p.selects : p.type === M.SELECT_UNSELECT_CARD ? p.select_cards : [];
      return cards.some((c) => c.code === condition.code && c.location === condition.location);
    }
    const substitute = this.substitutions.get(`${this.step?.id}:${condition.code}`);
    const count = ctx.readBoard(true).players[ctx.me][condition.zone].filter((c) => c?.code === (substitute?.code ?? condition.code)).length;
    if (substitute) return condition.absent ? count < substitute.count : count > substitute.count;
    return condition.absent ? count === 0 : count >= (condition.count ?? 1);
  }

  applies(ctx: BotContext): boolean {
    const intent = this.intents.current(ctx.resolvingEffect);
    const effectCode = ctx.resolvingEffect?.code ?? intent?.code;
    return Boolean(this.step && effectCode && stepHasEffect(this.step, effectCode, ctx.resolvingEffect?.description ?? intent?.description)
      && (!ctx.resolvingEffect || ctx.resolvingEffect.player === ctx.me));
  }

  targetScore(card: OcgCardLoc, ctx: BotContext): number | null {
    if (!this.applies(ctx) || !this.step || card.controller !== ctx.me) return null;
    const target = this.step.targets.find((t) => t.scope !== "action" && t.code === card.code && t.location === card.location);
    return target ? 100_000 : null;
  }

  recordSpend(cards: readonly OcgCardLoc[], ctx: BotContext): void {
    if (!this.step?.spend || !this.applies(ctx)) return;
    const expected = this.step.targets.filter((t) => t.location === L.HAND && t.scope !== "action");
    const actual = cards.filter((c) => c.location === L.HAND && c.controller === ctx.me);
    if (!expected.length || !actual.length) return;
    const zone = this.step.spend === "return" ? "hand" : this.step.spend === "banish" ? "banished" : "grave";
    const taken = new Set<number>();
    const thresholds = new Map<number, number>();
    const board = ctx.readBoard(true).players[ctx.me];
    for (const target of expected) {
      let index = actual.findIndex((card, i) => !taken.has(i) && card.code === target.code);
      if (index < 0) index = actual.findIndex((_, i) => !taken.has(i));
      if (index < 0) break;
      taken.add(index);
      const code = actual[index].code;
      const before = board[zone].filter((card) => card.code === code).length;
      const count = thresholds.get(code) ?? before;
      thresholds.set(code, count + 1);
      this.substitutions.set(`${this.step.id}:${target.code}`, { code, count });
    }
  }

  recordAttempt(ctx: BotContext): boolean {
    const mine = ctx.readBoard(true).players[ctx.me];
    const fingerprint = JSON.stringify([this.step?.id, mine.hand.map((c) => c.code).sort(), mine.deckSize,
      mine.grave.map((c) => c.code), mine.banished.map((c) => c.code),
      [...mine.monsters, ...mine.spells].map((c) => c ? [c.code, c.position, c.attack, c.counters] : null)]);
    this.repeatedAttempts = fingerprint === this.lastAttempt ? this.repeatedAttempts + 1 : 0;
    this.lastAttempt = fingerprint;
    if (this.repeatedAttempts < 3) return true;
    this.abandon("Ação repetida sem progresso; alternativa genérica preservada");
    return false;
  }

  abandon(reason: string): void {
    if (this.route) this.unavailable.add(this.route.id);
    this.route = null;
    this.stepIndex = 0;
    this.substitutions.clear();
    this.reason = reason;
    this.replans += 1;
  }
}
