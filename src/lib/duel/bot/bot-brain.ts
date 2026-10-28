import { engineRecoveryValue } from "@/lib/duel/bot/engine-tactics";
import {
  OcgLocation,
  OcgMessageType,
  OcgPhase,
  OcgPosition,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
  ocgPositionParse,
  type OcgCardLoc,
  type OcgCardLocActive,
  type OcgMessage,
  type OcgMessageSelectBattleCMD,
  type OcgMessageSelectCard,
  type OcgMessageSelectChain,
  type OcgMessageSelectIdlecmd,
  type OcgMessageSelectPosition,
  type OcgMessageSelectPlace,
  type OcgMessageSelectSum,
  type OcgMessageSelectTribute,
  type OcgMessageSelectUnselectCard,
  type OcgResponse,
} from "@n1xx1/ocgcore-wasm";

import { isDeclarable } from "@/lib/duel/announce-filter";
import type { BoardCard, BoardPlayer, BoardState } from "@/lib/duel/board-state";
import { botAutoResponse } from "@/lib/duel/bot-responder";
import { autoResponseFor } from "@/lib/duel/auto-response";
import {
  counterCostOf,
  FOG_TRAPS,
  readIntel,
  roleOf,
  type CardIntel,
} from "@/lib/duel/bot/card-intel";
import {
  appraiseAttack,
  knownStats,
  ownValue,
  threatOf,
} from "@/lib/duel/bot/combat";
import type { OfficialCardDb } from "@/lib/duel/official-card-data";
import { isValidSum, sumRequestOf } from "@/lib/duel/sum-selection";
import type { DuelDeckPayload, DuelFormat } from "@/lib/types";
import type { GuideDecision } from "@/lib/domain/deck-guide";
import { BOT_POLICIES, botDifficulty, botRandom, type BotDifficulty } from "@/lib/duel/bot/difficulty";
import { compatibleBotProfile, matchesBotProfile, validateBotProfile, type BotDeckProfile } from "@/lib/duel/bot/deck-profile";
import { BotPlanner } from "@/lib/duel/bot/planner";
import { guideHintsForDeck } from "@/lib/duel/bot/guide-hints";
import type { BotGuideHints } from "@/lib/duel/bot/guide-hints";
import { decisionEffectTarget, decisionHolds, decisionMoves, sequenceFollowUp, type DecisionMove } from "@/lib/duel/bot/decision-policy";
import { profileResponse, mirrorjadeScore } from "@/lib/duel/bot/effect-handlers";
import { actionValue, evaluateRoute, resourceValue } from "@/lib/duel/bot/evaluator";
import { effectModel, interruptionValue } from "@/lib/duel/bot/effect-model";
import { planBattle } from "@/lib/duel/bot/battle-planner";
import { validBotResponse } from "@/lib/duel/bot/response-validator";
import { decodeFieldMask } from "@/lib/duel/field-places";
import { linkedZones, pointedZones } from "@/lib/duel/link-geometry";
import { newBotDiagnostics, type BotActionIdentity, type BotCandidateTrace, type BotDecisionSource, type BotDecisionTrace } from "@/lib/duel/bot/decision-trace";
import type { BotEffect, BotFact } from "@/lib/duel/bot/knowledge";
import { effectValue, effectTargetValue } from "@/lib/duel/bot/effect-value";
import { PhantomStrategy } from "@/lib/duel/bot/phantom-strategy";
import { HeroStrategy } from "@/lib/duel/bot/hero-strategy";
import { SliferStrategy } from "@/lib/duel/bot/slifer-strategy";

/**
 * Tudo que o bot pode consultar para decidir uma jogada.
 *
 * `readBoard` é uma função, e não um tabuleiro pronto, porque ler o campo custa
 * dezenas de chamadas ao WASM: a maior parte dos prompts (posição, lugar,
 * ordenação) se resolve sem olhar o tabuleiro, e pagar a leitura em todos eles
 * é o que transformaria o turno do bot em espera. `full` traz o conteúdo das
 * pilhas — só a Main Phase precisa saber o que há no cemitério.
 */
export interface BotContext {
  strategy?: "stable" | "experimental";
  /** Inclui a extração e máscara da observação no orçamento total. */
  decisionStartedAt?: number;
  prompt: OcgMessage;
  me: 0 | 1;
  readBoard: (full: boolean) => BoardState;
  cardDb: OfficialCardDb;
  lifePoints: readonly [number, number];
  phase: number | null;
  turnPlayer: number | null;
  turnCount: number;
  /**
   * Quem ativou o último elo da corrente em aberto (`null` fora de uma
   * corrente). É o que separa "responder ao adversário" de "responder a mim
   * mesmo" — uma hand trap no próprio elo nega a própria jogada.
   */
  chainPlayer?: number | null;
  /**
   * Carta do último elo da corrente em aberto (`null` fora de uma corrente).
   * É o que uma contra-armadilha negaria: sem saber O QUE está em jogo, a
   * única decisão segura era guardá-la para sempre.
   */
  chainCode?: number | null;
  chainEffect?: BotEffect | null;
  attacksDeclared?: Readonly<Record<string, number>>;
  turnResources?: { normalUsed: boolean; effectsUsed: readonly string[]; restrictions: readonly string[] };
  /** Muda quando compra, embaralha ou move carta do/para o próprio Deck. */
  deckRevision?: number;
  /**
   * Monstro sendo Invocado agora — entre o SUMMONING (ou SPSUMMONING,
   * FLIPSUMMONING) e o fim da janela "quando um monstro seria Invocado", a
   * única em que o Julgamento Solene e a Corneta Celestial negam uma
   * Invocação. Fora dela, `null`.
   */
  summoning?: { code: number; player: number } | null;
  format?: DuelFormat;
  resolvingEffect?: BotEffect | null;
  chainOpen?: boolean;
  failedEffect?: { code: number; player: number; description?: bigint; revision: number } | null;
  retryCount?: number;
  observedFacts?: readonly BotFact[];
  chainTargets?: NonNullable<BotEffect["targets"]>;
}

export interface BotConfig {
  execution?: "auto" | "inline" | "worker";
  partialProfiles?: boolean;
  difficulty?: BotDifficulty;
  /** Desliga apenas em comparações com a política anterior. */
  sliferStrategy?: boolean;
  heroStrategy?: boolean;
  phantomStrategy?: boolean;
  /** Desliga a projeção de duas ações apenas em avaliações A/B. */
  sequencePlanning?: boolean;
  /** Comparação conjunta em calibração; só promover após a bateria de força. */
  candidateComparison?: boolean;
  /** Isola os modelos de efeito/combate da comparação de candidatos em A/B. */
  tacticalModel?: boolean;
  stateEvaluation?: boolean;
  opponentMemory?: boolean;
  recoveryPlanning?: boolean;
  /** Lista própria, sem ordem de compra. Nunca a lista adversária. */
  deck?: DuelDeckPayload;
  format?: DuelFormat;
  profile?: BotDeckProfile | null;
  /** Semente de desempate independente da semente do motor. */
  seed?: number;
  /** Diagnóstico privado e opt-in; não publicado na mesa de duelo. */
  onDecision?: (trace: BotDecisionTrace) => void;
}

/**
 * Tetos de decisões por turno.
 *
 * Não são afinação de dificuldade, são trava de segurança. Uma magia contínua
 * com efeito de ignição volta a aparecer em `activates` depois de resolvida, e
 * um bot que só olha "isto vale a pena?" a ativa para sempre — o duelo congela
 * com a barra de processamento girando, e nada na tela explica por quê. Ao
 * estourar o teto o bot para de agir e encerra a fase, que é sempre uma
 * resposta legal.
 */
const IDLE_BUDGET = 24;
const BATTLE_BUDGET = 12;
const CHAIN_BUDGET = 8;

/** Quantas vezes a MESMA carta pode ser ativada no mesmo turno. */
const SAME_CARD_ACTIVATIONS = 2;

/**
 * Nota mínima para o bot gastar uma carta encadeando.
 *
 * Fica logo abaixo da nota de "armadilha desconhecida no turno do oponente"
 * (55) e acima da de "armadilha no meu próprio turno" (25): o efeito prático é
 * que o bot responde às jogadas do adversário e guarda as cartas no turno dele,
 * sem precisar conhecer carta por carta.
 */
const CHAIN_THRESHOLD = 45;

/** Anel da Destruição — o dano volta para os DOIS jogadores. */
const RING_OF_DESTRUCTION = 83555666;
const RAIGEKI = 12580477;
const HARPIES_FEATHER_DUSTER = 18144506;

/**
 * Invocação-Pêndulo: vários monstros de uma vez, sem gastar a Invocação-Normal
 * nem carta nenhuma (as escalas ficam). Acima da Normal e das Especiais de
 * procedimento — e abaixo das magias de compra, que podem trazer mais
 * monstros para ela.
 */
const PENDULUM_SUMMON_SCORE = 112;

/**
 * Quanto um monstro do Extra Deck precisa valer A MAIS que os materiais para
 * o bot fazer a troca. Trocar dois corpos por um é perder carta: só compensa
 * com folga (um Link 1 de 300 ATK no lugar de um Battle Ox não compensa).
 */
const EXTRA_DECK_MIN_GAIN = 300;

/** Valor presumido de um material que não está no campo (vem da mão). */
const OFF_FIELD_MATERIAL = 800;

/** Fases da Battle Phase — onde hand trap de batalha (Kuriboh, Honest) serve. */
const BATTLE_PHASES =
  OcgPhase.BATTLE_START | OcgPhase.BATTLE_STEP | OcgPhase.DAMAGE | OcgPhase.DAMAGE_CAL | OcgPhase.BATTLE;

/** Uma jogada candidata, com a nota que a heurística lhe deu. */
interface Plan {
  score: number;
  response: OcgResponse;
  /** Carta que este plano ativa, quando ativa alguma — alimenta o anti-loop. */
  activated?: OcgCardLoc;
  /** Marca que o plano ocupa uma zona de magia/armadilha. */
  setsBackrow?: boolean;
  decision?: DecisionMove;
  continuation?: GuideDecision;
  hold?: GuideDecision;
  source?: BotDecisionSource;
  components?: Record<string, number>;
  reason?: string;
  lessonId?: string;
}

function chave(card: OcgCardLoc, effect = false): string {
  return `${card.code}:${card.controller}:${card.location}:${card.sequence}${effect ? `:${"description" in card ? String(card.description) : ""}` : ""}`;
}

function responseKey(response: OcgResponse): string {
  return JSON.stringify(response, (_, value) => typeof value === "bigint" ? `${value}n` : value);
}

function ocupadas(zonas: (BoardCard | null)[]): BoardCard[] {
  return zonas.filter((card): card is BoardCard => card !== null);
}

/**
 * O oponente do bot, na visão do tabuleiro.
 *
 * `readBoardState` devolve sempre `[jogador 0, jogador 1]`; quem é "eu" depende
 * do assento, e o bot não é necessariamente o assento 1 (num duelo bot contra
 * bot os dois existem).
 */
function lados(board: BoardState, me: 0 | 1): [BoardPlayer, BoardPlayer] {
  return me === 0
    ? [board.players[0], board.players[1]]
    : [board.players[1], board.players[0]];
}

/**
 * O oponente do bot.
 *
 * Decide olhando o tabuleiro e o que a carta faz, em vez de responder sempre o
 * primeiro item da lista. Guarda estado entre um prompt e outro porque as
 * decisões do engine vêm partidas em pedaços: escolher **quem ataca** e
 * escolher **quem apanha** são duas perguntas separadas, e sem lembrar a
 * primeira a segunda vira um chute.
 */
export class BotBrain {
  readonly difficulty: BotDifficulty;
  readonly diagnostics = newBotDiagnostics();
  readonly planner: BotPlanner;
  private readonly decisionGuide: BotGuideHints | null;
  private readonly sequencePlanning: boolean;
  private readonly candidateComparison: boolean;
  private readonly tacticalModel: boolean;
  private readonly stateEvaluation: boolean;
  private readonly opponentMemory: boolean;
  private readonly recoveryPlanning: boolean;
  private readonly deck: DuelDeckPayload | null;
  private readonly slifer: SliferStrategy | null;
  private readonly hero: HeroStrategy | null;
  private readonly phantom: PhantomStrategy | null;
  private guideLesson: string | null = null;
  lastTrace: BotDecisionTrace | null = null;
  private readonly random: () => number;
  private readonly onDecision?: (trace: BotDecisionTrace) => void;
  private deadline = Infinity;
  private progress = "";
  private previousResponse: OcgResponse | null = null;
  private rejected = new Set<string>();

  constructor(config: BotConfig = {}) {
    this.difficulty = botDifficulty(config.difficulty);
    this.random = botRandom(config.seed);
    const profile = config.partialProfiles && config.profile && config.deck
      ? compatibleBotProfile(config.profile,config.deck,config.format??config.deck.format??"goat")
      : config.profile && config.deck && validateBotProfile(config.profile)
      && matchesBotProfile(config.profile, config.deck, config.format ?? config.deck.format ?? "goat") ? config.profile : null;
    const guide = this.difficulty === "hard" && config.deck
      ? guideHintsForDeck(config.deck, config.format ?? config.deck.format ?? "goat") : null;
    this.decisionGuide = guide;
    this.sequencePlanning = config.sequencePlanning ?? true;
    this.candidateComparison = config.candidateComparison ?? config.stateEvaluation ?? false;
    this.tacticalModel = config.tacticalModel ?? this.candidateComparison;
    this.stateEvaluation = config.stateEvaluation ?? this.candidateComparison;
    this.opponentMemory = config.opponentMemory ?? true;
    this.recoveryPlanning = config.recoveryPlanning ?? true;
    this.deck = config.deck ?? null;
    this.slifer = config.sliferStrategy !== false && guide?.tactics === "slifer" && this.deck ? new SliferStrategy(this.deck) : null;
    this.phantom = config.phantomStrategy !== false && guide?.tactics === "phantom-knights" && this.deck ? new PhantomStrategy(this.deck) : null;
    this.hero = config.heroStrategy !== false && guide?.tactics === "hero" && this.deck ? new HeroStrategy(this.deck) : null;
    this.planner = new BotPlanner(profile, this.deck, profile ? null : guide, this.recoveryPlanning);
    this.onDecision = config.onDecision;
  }
  /** Turno a que o estado abaixo se refere — muda, zera tudo. */
  private turn = -1;
  private idleSteps = 0;
  private battleSteps = 0;
  private chainSteps = 0;
  /** Cartas já baixadas na zona de magia/armadilha neste turno. */
  private setsNoTurno = 0;
  /** Quantas vezes cada carta já foi ativada neste turno (anti-loop). */
  private readonly activations = new Map<string, number>();
  /**
   * Monstro que o bot escolheu atacar, guardado entre o SELECT_BATTLECMD e o
   * SELECT_CARD em que o core pede o alvo.
   */
  private plannedTarget: { controller: number; sequence: number; code: number | null } | null = null;
  private plannedSummonCode: number | null = null;
  private pendingDecisionTarget: number | null = null;
  private usedGuideDecision: string | null = null;
  private candidates: BotCandidateTrace[] = [];
  private decisionSource: BotDecisionSource = "heuristic";
  private replacement: BotDecisionTrace["replacement"] = null;
  private chosenCandidateId: string | null = null;

  /**
   * Decide a resposta a um prompt.
   *
   * Qualquer erro cai no `botAutoResponse`, o respondedor antigo: ele não joga
   * bem, mas responde *tudo* de um jeito que o core aceita. É essa rede que
   * garante que uma heurística nova com defeito estrague uma jogada em vez de
   * travar o duelo inteiro.
   */
  decide(ctx: BotContext): OcgResponse {
    const read = ctx.readBoard;
    let observedBoard: BoardState | null = null;
    let fullBoard: BoardState | null = null;
    let partialBoard: BoardState | null = null;
    ctx = { ...ctx, strategy: this.tacticalModel ? "experimental" : "stable", observedFacts: this.opponentMemory ? ctx.observedFacts : [],
      readBoard: (full) => {
        observedBoard = full ? (fullBoard ??= read(true)) : (fullBoard ?? (partialBoard ??= read(false)));
        return observedBoard;
      } };
    const started = ctx.decisionStartedAt ?? performance.now();
    this.usedGuideDecision = null;
    this.guideLesson = null;
    this.candidates = [];
    this.chosenCandidateId = null;
    this.replacement = null;
    this.decisionSource = "heuristic";
    const policy = BOT_POLICIES[this.difficulty];
    // A busca usa o orçamento da dificuldade; 40 ms é o teto atual na thread
    // da mesa. O corte fixo anterior de 12 ms anulava a diferença entre níveis.
    this.deadline = started + policy.cpuMs;
    let fallback: string | null = null;
    const replansBefore = this.planner.replans;
    if (ctx.turnCount !== this.turn) {
      this.turn = ctx.turnCount;
      this.idleSteps = 0;
      this.battleSteps = 0;
      this.chainSteps = 0;
      this.setsNoTurno = 0;
      this.activations.clear();
      this.plannedSummonCode = null;
      this.pendingDecisionTarget = null;
    }
    if (ctx.prompt.type === OcgMessageType.SELECT_IDLECMD) this.pendingDecisionTarget = null;
    if (ctx.retryCount) {
      this.diagnostics.rejected += 1;
      if (this.previousResponse) this.rejected.add(responseKey(this.previousResponse));
      this.planner.abandon("Resposta rejeitada pelo motor; usando outra alternativa");
    } else this.rejected.clear();
    let response: OcgResponse | null = null;
    try {
      response = autoResponseFor(ctx.prompt, { resolvingCode: ctx.resolvingEffect?.code });
      if (response) this.decisionSource = "automatic";
      else {
        this.observeProgress(ctx);
        this.planner.observe(ctx, policy, this.deadline);
        this.slifer?.prepare(ctx);
        const guided = this.slifer?.respond(ctx) ?? this.hero?.respond(ctx) ?? this.phantom?.respond(ctx);
        if (guided) {
          response = guided.response; this.decisionSource = "guide"; this.guideLesson = guided.lessonId;
          this.candidates.push(this.candidate(ctx, response, 100, "guide", guided.reason));
        } else {
          response = ctx.prompt.type === OcgMessageType.SELECT_IDLECMD && this.candidateComparison ? null : profileResponse(ctx, this.planner, policy);
          if (response) this.decisionSource = "route";
          else response = this.think(ctx);
        }
      }
      if (!response) { fallback = "Efeito sem modelo específico; reserva genérica"; this.decisionSource = "fallback-unmodeled"; }
      else if (!validBotResponse(ctx.prompt, response, ctx.cardDb)) {
        this.replacement = { reason: "Resposta reprovada no contrato do prompt", preferred: response };
        response = null;
        fallback = "Resposta reprovada no contrato do prompt";
        this.decisionSource = "rejected-recovery";
      }
    } catch (error) {
      response = null;
      fallback = `Falha na análise: ${error instanceof Error ? error.message : "erro desconhecido"}`;
      this.decisionSource = "fallback-error";
    }
    response = this.safeResponse(ctx, response);
    this.slifer?.record(ctx, response);
    this.hero?.record(ctx, response);
    this.phantom?.record(ctx, response);
    if (ctx.retryCount) this.decisionSource = "rejected-recovery";
    if (this.usedGuideDecision && this.decisionSource === "heuristic") this.decisionSource = "guide";
    if (!fallback && this.decisionSource === "fallback-unmodeled") fallback = "Escolha sem modelo específico; respondedor genérico ou ordem obrigatória";
    const finalKey = responseKey(response);
    let selected = this.candidates.find(candidate => candidate.id === this.chosenCandidateId && responseKey(candidate.response) === finalKey)
      ?? this.candidates.find(candidate => responseKey(candidate.response) === finalKey);
    if (!selected || selected.source !== this.decisionSource) {
      selected = this.candidate(ctx, response, 0, this.decisionSource,
        fallback ?? (this.decisionSource === "route" ? this.planner.reason : "Escolha local do prompt"));
      this.candidates.push(selected);
    }
    if (ctx.prompt.type === OcgMessageType.SELECT_IDLECMD && response.type === OcgResponseType.SELECT_IDLECMD) {
      const cards = response.action === SelectIdleCMDAction.SELECT_SPECIAL_SUMMON ? ctx.prompt.special_summons
        : response.action === SelectIdleCMDAction.SELECT_SUMMON ? ctx.prompt.summons : null;
      if (cards && response.index !== null) this.plannedSummonCode = cards[response.index]?.code ?? null;
    }
    this.previousResponse = response;
    const elapsedMs = performance.now() - started;
    const trace: BotDecisionTrace = {
      difficulty: this.difficulty, profile: this.planner.profile?.id ?? null, revision: this.planner.profile?.revision ?? null,
      turn: ctx.turnCount, prompt: ctx.prompt.type, objective: this.planner.route?.objective ?? "Combate, sobrevivência e recursos disponíveis",
      route: this.planner.route?.id ?? null, alternatives: [...this.planner.alternatives], response,
      source: this.decisionSource, candidates: this.candidates, selected: selected.id, replacement: this.replacement,
      capabilities: { candidateComparison: this.candidateComparison, stateEvaluation: this.stateEvaluation,
        sequencePlanning: this.sequencePlanning, opponentMemory: this.opponentMemory, recoveryPlanning: this.recoveryPlanning,
        sliferStrategy: this.slifer !== null, heroStrategy: this.hero !== null, phantomStrategy: this.phantom !== null },
      guideDecision: this.usedGuideDecision,
      guideLesson: this.guideLesson,
      reason: (this.decisionSource === "guide" && this.usedGuideDecision ? this.planner.reason : selected.reason)
        + (this.planner.replans > replansBefore ? `; ${this.planner.reason}` : ""),
      fallback: fallback ?? this.replacement?.reason ?? null, elapsedMs, budgetExhausted: performance.now() >= this.deadline,
      planning:{goal:this.planner.goal?.objective??null,transition:this.planner.step?.id??null,
        branches:this.planner.step?this.planner.transitions.get(this.planner.step.id)?.next??[]:[],predictions:this.planner.predictionChecks.slice(-8)},
      observation: { me: ctx.me, prompt: ctx.prompt, board: observedBoard, lifePoints: [...ctx.lifePoints], phase: ctx.phase,
        chainCode: ctx.chainCode ?? null, resolvingCode: ctx.resolvingEffect?.code ?? null,
        resolvingPlayer: ctx.resolvingEffect?.player ?? null,
        resolvingDescription: ctx.resolvingEffect?.description?.toString() ?? null, step: this.planner.step?.id ?? null },
    };
    this.lastTrace = trace;
    this.diagnostics.decisions += 1;
    this.diagnostics.sources[trace.source] += 1;
    this.diagnostics.fallbacks += trace.source.startsWith("fallback") || trace.source === "rejected-recovery" ? 1 : 0;
    this.diagnostics.replans = this.planner.replans;
    this.diagnostics.budgetExhaustions += trace.budgetExhausted ? 1 : 0;
    this.diagnostics.timings.push(elapsedMs);
    if (this.diagnostics.timings.length > 2048) this.diagnostics.timings.shift();
    // Um consumidor de telemetria com defeito não pode alterar a jogada.
    try { this.onDecision?.(trace); } catch { /* diagnóstico opcional */ }
    return response;
  }

  private observeProgress(ctx: BotContext): void {
    if (![OcgMessageType.SELECT_IDLECMD, OcgMessageType.SELECT_BATTLECMD, OcgMessageType.SELECT_CHAIN].includes(ctx.prompt.type)) return;
    const board = ctx.readBoard(ctx.prompt.type === OcgMessageType.SELECT_IDLECMD || this.planner.route !== null);
    const fingerprint = JSON.stringify([ctx.turnCount, ctx.phase, ctx.lifePoints, board.players.map((p) => [
      p.hand.map((c) => c.code).sort(), p.deckSize, p.graveSize, p.banishedSize, p.extraSize,
      [...p.monsters, ...p.spells].map((c) => c ? [c.code, c.position, c.attack, c.negated, c.counters] : null),
    ])]);
    if (fingerprint !== this.progress) {
      this.progress = fingerprint;
      this.idleSteps = 0;
      this.battleSteps = 0;
      this.chainSteps = 0;
      this.activations.clear();
    }
  }

  private safeResponse(ctx: BotContext, preferred: OcgResponse | null): OcgResponse {
    const p = ctx.prompt;
    const candidates: OcgResponse[] = preferred ? [preferred] : [];
    candidates.push(botAutoResponse(p));
    if (p.type === OcgMessageType.SELECT_CARD) {
      if (p.can_cancel) candidates.push({ type: OcgResponseType.SELECT_CARD, indicies: null });
      for (let start = 0; start < p.selects.length; start += 1) candidates.push({ type: OcgResponseType.SELECT_CARD,
        indicies: Array.from({ length: p.min }, (_, i) => (start + i) % p.selects.length) });
      if (p.min === 0) candidates.push({ type: OcgResponseType.SELECT_CARD, indicies: [] });
    } else if (p.type === OcgMessageType.SELECT_UNSELECT_CARD) {
      if (p.can_finish || p.can_cancel) candidates.push({ type: OcgResponseType.SELECT_UNSELECT_CARD, index: null });
      p.select_cards.forEach((_, index) => candidates.push({ type: OcgResponseType.SELECT_UNSELECT_CARD, index }));
    } else if (p.type === OcgMessageType.SELECT_CHAIN) {
      if (!p.forced) candidates.push({ type: OcgResponseType.SELECT_CHAIN, index: null });
      p.selects.forEach((_, index) => candidates.push({ type: OcgResponseType.SELECT_CHAIN, index }));
    } else if (p.type === OcgMessageType.SELECT_IDLECMD) {
      if (p.to_ep) candidates.push({ type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null });
      if (p.to_bp) candidates.push({ type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null });
      const lists = [[p.summons, SelectIdleCMDAction.SELECT_SUMMON], [p.special_summons, SelectIdleCMDAction.SELECT_SPECIAL_SUMMON],
        [p.activates, SelectIdleCMDAction.SELECT_ACTIVATE], [p.monster_sets, SelectIdleCMDAction.SELECT_MONSTER_SET],
        [p.spell_sets, SelectIdleCMDAction.SELECT_SPELL_SET], [p.pos_changes, SelectIdleCMDAction.SELECT_POS_CHANGE]] as const;
      for (const [cards, action] of lists) cards.forEach((_, index) => candidates.push({ type: OcgResponseType.SELECT_IDLECMD, action, index }));
    } else if (p.type === OcgMessageType.SELECT_OPTION) {
      p.options.forEach((_, index) => candidates.push({ type: OcgResponseType.SELECT_OPTION, index }));
    } else if (p.type === OcgMessageType.SELECT_EFFECTYN) candidates.push({ type: OcgResponseType.SELECT_EFFECTYN, yes: false });
    else if (p.type === OcgMessageType.SELECT_YESNO) candidates.push({ type: OcgResponseType.SELECT_YESNO, yes: false });
    const chosen = candidates.find((r) => !this.rejected.has(responseKey(r)) && validBotResponse(p, r, ctx.cardDb))
      ?? candidates.find((r) => validBotResponse(p, r, ctx.cardDb)) ?? candidates[0];
    if (!preferred || responseKey(chosen) !== responseKey(preferred)) {
      this.replacement ??= { preferred, reason: preferred ? "Resposta anterior rejeitada; selecionada alternativa legal" : "Ausência de resposta modelada; respondedor genérico" };
      if (preferred) {
        this.decisionSource = "rejected-recovery";
        this.plannedTarget = null;
        this.pendingDecisionTarget = null;
        this.usedGuideDecision = null;
        this.planner.intents.clear();
        this.planner.abandon(this.replacement.reason);
      }
    }
    return chosen;
  }

  private candidate(ctx: BotContext, response: OcgResponse, score: number,
    source: BotDecisionSource = "heuristic", reason = "Valor local da ação", components: Record<string, number> = { heuristic: score }): BotCandidateTrace {
    const p = ctx.prompt;
    let card: OcgCardLoc | undefined;
    if (p.type === OcgMessageType.SELECT_IDLECMD && response.type === OcgResponseType.SELECT_IDLECMD && response.index !== null) {
      const lists = { [SelectIdleCMDAction.SELECT_SUMMON]: p.summons, [SelectIdleCMDAction.SELECT_SPECIAL_SUMMON]: p.special_summons,
        [SelectIdleCMDAction.SELECT_ACTIVATE]: p.activates, [SelectIdleCMDAction.SELECT_MONSTER_SET]: p.monster_sets,
        [SelectIdleCMDAction.SELECT_SPELL_SET]: p.spell_sets, [SelectIdleCMDAction.SELECT_POS_CHANGE]: p.pos_changes };
      card = lists[response.action as keyof typeof lists]?.[response.index];
    } else if (p.type === OcgMessageType.SELECT_CHAIN && response.type === OcgResponseType.SELECT_CHAIN && response.index !== null) card = p.selects[response.index];
    else if (p.type === OcgMessageType.SELECT_CARD && response.type === OcgResponseType.SELECT_CARD) card = p.selects[response.indicies?.[0] ?? -1];
    else if (p.type === OcgMessageType.SELECT_UNSELECT_CARD && response.type === OcgResponseType.SELECT_UNSELECT_CARD && response.index!==null) card=p.select_cards[response.index]??p.unselect_cards[response.index-p.select_cards.length];
    else if (p.type === OcgMessageType.SELECT_SUM && response.type === OcgResponseType.SELECT_SUM) card=p.selects[response.indicies[0]];
    else if (p.type === OcgMessageType.SELECT_TRIBUTE && response.type === OcgResponseType.SELECT_TRIBUTE) card=p.selects[response.indicies?.[0]??-1];
    else if (p.type === OcgMessageType.SELECT_EFFECTYN) card = p;
    else if (p.type === OcgMessageType.SELECT_BATTLECMD && response.type === OcgResponseType.SELECT_BATTLECMD && response.index !== null) {
      card = response.action === SelectBattleCMDAction.SELECT_BATTLE ? p.attacks[response.index] : p.chains[response.index];
    }
    const identity: BotActionIdentity | null = card ? { code: card.code, controller: card.controller,
      location: card.location, sequence: card.sequence, description: "description" in card ? String(card.description) : null } : null;
    const resources = response.type === OcgResponseType.SELECT_IDLECMD && response.action === SelectIdleCMDAction.SELECT_SUMMON ? ["normal-summon"] : [];
    if (p.type === OcgMessageType.SELECT_CARD && response.type === OcgResponseType.SELECT_CARD) {
      for (const index of response.indicies ?? []) {
        const chosen = p.selects[index];
        if (chosen?.controller === ctx.me && chosen.location === OcgLocation.HAND) resources.push(`selected-hand:${chave(chosen)}`);
      }
    }
    const targetCards=(p.type===OcgMessageType.SELECT_CARD&&response.type===OcgResponseType.SELECT_CARD
      ||p.type===OcgMessageType.SELECT_SUM&&response.type===OcgResponseType.SELECT_SUM
      ||p.type===OcgMessageType.SELECT_TRIBUTE&&response.type===OcgResponseType.SELECT_TRIBUTE)
      ?(response.indicies??[]).map(index=>p.selects[index]).filter(Boolean):[];
    const targets=targetCards.map(target=>({code:target.code,controller:target.controller,location:target.location,sequence:target.sequence,
      description:"description" in target?String(target.description):null}));
    return { id: `${source}:${responseKey(response)}`, source, response, score, components, reason, identity,targets,
      resources, expected: source === "route" ? this.planner.route?.objective ?? "Confirmar o resultado no campo" : reason,
      confidence: source === "automatic" ? "modeled" : source.startsWith("fallback") ? "unknown" : "heuristic" };
  }

  /** @returns `null` quando não há heurística e o fallback deve responder. */
  private think(ctx: BotContext): OcgResponse | null {
    const { prompt } = ctx;
    switch (prompt.type) {
      case OcgMessageType.SELECT_IDLECMD:
        return this.idle(prompt, ctx);
      case OcgMessageType.SELECT_BATTLECMD:
        return this.battle(prompt, ctx);
      case OcgMessageType.SELECT_CHAIN:
        return this.chain(prompt, ctx);
      case OcgMessageType.SELECT_EFFECTYN:
        if (prompt.controller === ctx.me) {
          const value = effectValue(prompt, ctx);
          if (value !== null) {
            if (value > 0) this.noteActivation(prompt);
            return { type: OcgResponseType.SELECT_EFFECTYN, yes: value > 0 };
          }
        }
        if (this.decisionGuide?.id === "tcg-lehd-destiny-hero" && prompt.code === 91691605
          && prompt.controller === ctx.me) {
          const hand = ctx.readBoard(true).players[ctx.me].hand;
          const usefulTarget = hand.some((card) => card.code !== 26964762 && card.code !== null
            && (ctx.cardDb.get(card.code)?.setcodes.includes(49160) ?? false)
            && (ctx.cardDb.get(card.code)?.atk ?? Infinity) <= 1600);
          if (!usefulTarget) return { type: OcgResponseType.SELECT_EFFECTYN, yes: false };
        }
        if (this.decisionGuide?.id === "tcg-l26d-sky-striker" && prompt.code === 37351133
          && prompt.controller === ctx.me && ctx.turnPlayer === ctx.me) {
          const mine = ctx.readBoard(true).players[ctx.me];
          if (mine.monsters.slice(0, 5).some((card) => card?.code === 26077387)
            && mine.extra.some((card) => card.code === 63288573 || card.code === 90673288)) {
            return { type: OcgResponseType.SELECT_EFFECTYN, yes: false };
          }
        }
        return null;
      case OcgMessageType.SELECT_CARD:
        return this.selectCard(prompt, ctx);
      case OcgMessageType.SELECT_UNSELECT_CARD:
        return this.selectUnselect(prompt, ctx);
      case OcgMessageType.SELECT_TRIBUTE:
        return this.tribute(prompt, ctx);
      case OcgMessageType.SELECT_POSITION:
        return this.position(prompt, ctx);
      case OcgMessageType.SELECT_PLACE:
        return this.difficulty === "hard" ? this.place(prompt, ctx) : null;
      case OcgMessageType.ANNOUNCE_CARD:
        return this.announceCard(prompt.opcodes, ctx);
      case OcgMessageType.SELECT_SUM:
        return this.selectSum(prompt, ctx);
      default:
        return null;
    }
  }

  /**
   * Declara um nome que o filtro do core aceita.
   *
   * O respondedor de reserva declara sempre o Touro Guerreiro — que passa nos
   * filtros "não pode ser Extra Deck" do Goat e em nenhum outro: "declare 1
   * 'Gadget'" virava RETRY em laço. Aqui vai a mesma conta do core
   * (`isDeclarable`), e a ordem de preferência é o que o bot **pode saber**
   * sem trapacear: primeiro as cartas que o adversário já mostrou (campo,
   * cemitério, banidas — "declare uma carta; se estiver na mão dele…"),
   * depois as do próprio bot (efeitos que declaram para buscar ou copiar), e
   * só então o primeiro nome do banco que passar no filtro.
   */
  private announceCard(opcodes: readonly bigint[], ctx: BotContext): OcgResponse | null {
    const passa = (code: number) => {
      const data = ctx.cardDb.get(code);
      return (
        data !== null &&
        isDeclarable(opcodes, {
          code,
          alias: data.alias,
          type: data.type,
          race: data.race,
          attribute: data.attribute,
          setcodes: data.setcodes,
        })
      );
    };

    let vistos: number[] = [];
    try {
      const [mine, foe] = lados(ctx.readBoard(true), ctx.me);
      const publicas = (lado: BoardPlayer) => [
        ...ocupadas(lado.monsters),
        ...ocupadas(lado.spells),
        ...lado.grave,
        ...lado.banished,
      ];
      vistos = [...publicas(foe), ...publicas(mine), ...mine.hand]
        .map((card) => card.code)
        .filter((code): code is number => code !== null && code > 0);
    } catch {
      // Sem tabuleiro, segue só com o banco.
    }
    for (const code of new Set(vistos)) {
      if (passa(code)) return { type: OcgResponseType.ANNOUNCE_CARD, card: code };
    }
    for (const code of ctx.cardDb.passcodes()) {
      if (passa(code)) return { type: OcgResponseType.ANNOUNCE_CARD, card: code };
    }
    return null;
  }

  // ── Main Phase ─────────────────────────────────────────────────────────

  private idle(
    message: OcgMessageSelectIdlecmd,
    ctx: BotContext,
  ): OcgResponse {
    this.idleSteps += 1;
    const idle = (action: SelectIdleCMDAction, index: number | null) =>
      ({ type: OcgResponseType.SELECT_IDLECMD, action, index }) as OcgResponse;

    // Teto estourado: encerra a fase em vez de continuar decidindo.
    if (this.idleSteps > IDLE_BUDGET) {
      return message.to_bp
        ? idle(SelectIdleCMDAction.TO_BP, null)
        : idle(SelectIdleCMDAction.TO_EP, null);
    }

    const board = ctx.readBoard(true);
    const [mine, foe] = lados(board, ctx.me);
    let plans: Plan[] = [];

    message.activates.forEach((card, index) => {
      // `to_bp` só existe na Main Phase 1: é o "ainda dá para atacar".
      const score = this.scoreActivation(card, ctx, mine, foe, message.to_bp);
      if (score > 0) {
        plans.push({
          score,
          response: idle(SelectIdleCMDAction.SELECT_ACTIVATE, index),
          activated: card,
        });
      }
    });

    message.special_summons.forEach((card, index) => {
      const score = this.scoreSpecialSummon(card, ctx, mine);
      if (score > 0) {
        plans.push({
          score,
          response: idle(SelectIdleCMDAction.SELECT_SPECIAL_SUMMON, index),
        });
      }
    });

    message.summons.forEach((card, index) => {
      const score = this.scoreSummon(card, ctx, mine);
      if (score > 0) {
        plans.push({ score, response: idle(SelectIdleCMDAction.SELECT_SUMMON, index) });
      }
    });

    message.monster_sets.forEach((card, index) => {
      const score = this.scoreSet(card, ctx);
      if (score > 0) {
        plans.push({
          score,
          response: idle(SelectIdleCMDAction.SELECT_MONSTER_SET, index),
        });
      }
    });

    // Baixar armadilha é a jogada mais subestimada do formato: custa uma carta
    // que já estava parada na mão e cria a ameaça que segura o ataque do
    // oponente. O bot antigo só chegava aqui quando não tinha o que invocar.
    const zonasLivres = mine.spells.filter((zone) => zone === null).length;
    message.spell_sets.forEach((card, index) => {
      const score = this.scoreBackrowSet(card, ctx, zonasLivres);
      if (score > 0) {
        plans.push({
          score,
          response: idle(SelectIdleCMDAction.SELECT_SPELL_SET, index),
          setsBackrow: true,
        });
      }
    });

    message.pos_changes.forEach((card, index) => {
      const score = this.scorePosChange(card, ctx, mine, foe);
      if (score > 0) {
        plans.push({
          score,
          response: idle(SelectIdleCMDAction.SELECT_POS_CHANGE, index),
        });
      }
    });

    if (message.to_bp) {
      plans.push({
        score: this.battlePhaseValue(mine, foe),
        response: idle(SelectIdleCMDAction.TO_BP, null),
      });
    }
    if (message.to_ep) {
      // Piso: passar o turno é sempre legal, e vence qualquer plano negativo.
      plans.push({ score: 1, response: idle(SelectIdleCMDAction.TO_EP, null) });
    }

    // Os cenários do Aprender só influenciam ações oferecidas pelo motor.
    // Rotas, guias e ações genéricas participam da mesma comparação.
    if (this.decisionGuide && this.deck) {
      for (const hold of decisionHolds(this.decisionGuide.decisions, board, ctx.me, this.deck)) {
        const action = hold.choices[hold.correctChoice].action;
        if (!action || action.kind !== "hold") continue;
        for (const plan of plans) {
          if (plan.response.type !== OcgResponseType.SELECT_IDLECMD) continue;
          const r = plan.response;
          const list = r.action === SelectIdleCMDAction.SELECT_ACTIVATE ? message.activates
            : r.action === SelectIdleCMDAction.SELECT_SUMMON ? message.summons : r.action === SelectIdleCMDAction.SELECT_SPECIAL_SUMMON ? message.special_summons : [];
          if (r.index !== null && list[r.index]?.code === action.code) {
            plan.score -= 65;
            plan.reason = `Guardar recurso: ${hold.title}`;
          }
          if (r.action === SelectIdleCMDAction.TO_EP || r.action === SelectIdleCMDAction.TO_BP) {
            plan.score += 35; plan.source = "guide"; plan.hold = hold; plan.reason = `Guardar recurso: ${hold.title}`;
          }
        }
      }
      for (const move of decisionMoves(this.decisionGuide.decisions, board, ctx.me, this.deck, message)) {
        if (move.action === SelectIdleCMDAction.SELECT_ACTIVATE
          && (this.activations.get(chave(move.card, this.tacticalModel)) ?? 0) >= SAME_CARD_ACTIVATIONS) continue;
        const existing = plans.find((plan) => plan.response.type === OcgResponseType.SELECT_IDLECMD
          && plan.response.action === move.action && plan.response.index === move.index);
        const heldTarget = move.targetCode && mine.hand.some(card => card.code === move.targetCode);
        const accessGain = move.targetCode && !heldTarget ? 35 : 0;
        const extensionGain = heldTarget ? 30 : 0;
        const evidence = 25 + accessGain + extensionGain;
        if (existing) {
          const gain = this.candidateComparison ? evidence : Math.max(0,125-existing.score);
          existing.components = this.candidateComparison
            ? { heuristic: existing.score, guideContext: 25, missingPiece: accessGain, continuation: extensionGain }
            : { heuristic: existing.score, editorialPrior: gain };
          existing.score += gain;
          existing.decision = move;
        } else {
          plans.push({ score: this.candidateComparison ? 70 + evidence : 125, response: idle(move.action, move.index),
            components: this.candidateComparison ? { contextualAction: 70, guideContext: 25, missingPiece: accessGain, continuation: extensionGain } : { editorialPrior: 125 },
            activated: move.action === SelectIdleCMDAction.SELECT_ACTIVATE ? move.card : undefined,
            decision: move });
        }
      }
      // Uma Invocação da mão pode liberar a próxima decisão do guia. Avaliar
      // o estado projetado dá valor ao primeiro passo; a continuação só será
      // feita se o core a oferecer de verdade após resolver os efeitos.
      for (const plan of this.sequencePlanning ? plans : []) {
        if (plan.decision || plan.response.type !== OcgResponseType.SELECT_IDLECMD
          || plan.response.index === null) continue;
        const action = plan.response.action;
        if (action !== SelectIdleCMDAction.SELECT_SUMMON && action !== SelectIdleCMDAction.SELECT_SPECIAL_SUMMON) continue;
        const card = action === SelectIdleCMDAction.SELECT_SUMMON
          ? message.summons[plan.response.index] : message.special_summons[plan.response.index];
        const next = sequenceFollowUp(this.decisionGuide.decisions, board, ctx.me, this.deck, action, card);
        if (next) {
          plan.score = this.candidateComparison ? plan.score + 40 : Math.max(plan.score,121);
          plan.continuation = next;
        }
      }
    }

    if(this.candidateComparison)for(const [cards,action]of [[message.summons,SelectIdleCMDAction.SELECT_SUMMON],[message.activates,SelectIdleCMDAction.SELECT_ACTIVATE]] as const)
      cards.forEach((card,index)=>{
        if(engineRecoveryValue(this.decisionGuide?.id,ctx,action,index)&&!plans.some(plan=>plan.response.type===OcgResponseType.SELECT_IDLECMD&&plan.response.action===action&&plan.response.index===index))
          plans.push({score:70,response:idle(action,index),activated:action===SelectIdleCMDAction.SELECT_ACTIVATE?card:undefined});
      });
    if(this.candidateComparison)for(const plan of plans)if(plan.response.type===OcgResponseType.SELECT_IDLECMD&&plan.response.index!==null){
      const recovery=engineRecoveryValue(this.decisionGuide?.id,ctx,plan.response.action,plan.response.index);
      if(recovery){plan.components={...(plan.components??{heuristic:plan.score}),engineRecovery:recovery};plan.score+=recovery;plan.reason="Recuperar uma peça observável do motor";}
    }

    const step = this.planner.step;
    if (step?.action) {
      const action = { summons: SelectIdleCMDAction.SELECT_SUMMON, special_summons: SelectIdleCMDAction.SELECT_SPECIAL_SUMMON,
        activates: SelectIdleCMDAction.SELECT_ACTIVATE }[step.action.kind];
      const index = message[step.action.kind].findIndex(c => c.code === step.action!.code);
      if (index >= 0 && this.planner.route) {
        const rating = evaluateRoute(this.planner.route, ctx, BOT_POLICIES[this.difficulty]);
        const response = idle(action, index);
        const existing = plans.find(plan => responseKey(plan.response) === responseKey(response));
        const routePlan: Plan = { score: rating.score, response, source: "route", reason: rating.reason,
          components: rating.components };
        if (existing) Object.assign(existing, routePlan); else plans.push(routePlan);
      }
    }
    if (this.stateEvaluation && this.difficulty !== "easy") for (const plan of plans) {
      // Um papel de starter não prova que o efeito tenha continuação nesta
      // mão. Só cobre o custo de oportunidade de uma linha viável agora.
      const starters = this.planner.starters.filter(code => this.planner.openingReady(code, mine)
        || plans.some(other => (other.decision || other.continuation || other.source === "route")
          && other.response.type === OcgResponseType.SELECT_IDLECMD && other.response.action === SelectIdleCMDAction.SELECT_SUMMON
          && other.response.index !== null && message.summons[other.response.index]?.code === code));
      const parts = actionValue(ctx, plan.response, starters);
      // O guia confirma uma função de acesso contextual que a lista de papéis
      // por código pode não cobrir (ex.: Broca-negra + Decisor).
      if (plan.decision || plan.continuation) delete parts.normalOpportunity;
      if (this.planner.route) {
        // Não confundir o corpo intermediário com o objetivo já alcançado.
        delete parts.preserve;
        if (plan.source === "route") delete parts.extensionCost;
      }
      plan.components = { ...(plan.components ?? { heuristic: plan.score }), ...parts };
      plan.score += Object.values(parts).reduce((sum, n) => sum + n, 0);
    }

    // As políticas revisadas comparam cada ação legal aos custos e continuações.
    if (this.slifer || this.hero || this.phantom) for (const [cards, action] of [
      [message.activates, SelectIdleCMDAction.SELECT_ACTIVATE], [message.summons, SelectIdleCMDAction.SELECT_SUMMON],
      [message.special_summons, SelectIdleCMDAction.SELECT_SPECIAL_SUMMON], [message.monster_sets, SelectIdleCMDAction.SELECT_MONSTER_SET],
      [message.spell_sets, SelectIdleCMDAction.SELECT_SPELL_SET],
    ] as const) cards.forEach((card, index) => {
      const value = this.slifer?.idle(action, card, ctx) ?? this.hero?.idle(action, card, ctx) ?? this.phantom?.idle(action, card, ctx);
      if (!value) return;
      if (action === SelectIdleCMDAction.SELECT_ACTIVATE && (this.activations.get(chave(card, this.tacticalModel)) ?? 0) >= SAME_CARD_ACTIVATIONS) return;
      const existing = plans.findIndex(plan => plan.response.type === OcgResponseType.SELECT_IDLECMD
        && plan.response.action === action && plan.response.index === index);
      if (value.score <= 0) { if (existing >= 0) plans.splice(existing, 1); return; }
      const plan: Plan = { ...(existing >= 0 ? plans[existing] : {}), score: value.score, response: idle(action, index),
        source: "guide", reason: value.reason, lessonId: value.lessonId, components: { [this.phantom ? "phantomStrategy" : this.hero ? "heroStrategy" : "sliferStrategy"]: value.score },
        activated: action === SelectIdleCMDAction.SELECT_ACTIVATE ? card : undefined,
        setsBackrow: action === SelectIdleCMDAction.SELECT_SPELL_SET };
      if (existing >= 0) plans[existing] = plan; else plans.push(plan);
    });

    // Guias e rotas também precisam justificar o gasto. Um bônus editorial
    // não pode recriar uma ativação que só destruiria nossos recursos.
    plans = plans.filter(plan => {
      const r = plan.response;
      return r.type !== OcgResponseType.SELECT_IDLECMD || r.action !== SelectIdleCMDAction.SELECT_ACTIVATE
        || r.index === null || (effectValue(message.activates[r.index], ctx) ?? 1) > 0;
    });

    // Sem nada melhor a fazer e sem End Phase oferecida (Main 2 depois de uma
    // batalha), o core ainda espera resposta — o fallback é quem sabe montá-la.
    if (plans.length === 0) { this.decisionSource = "fallback-unmodeled"; return botAutoResponse(message); }

    this.candidates = plans.map((plan) => this.candidate(ctx, plan.response, plan.score,
      plan.source ?? (plan.decision || plan.continuation ? "guide" : "heuristic"),
      plan.reason ?? (plan.decision ? `Cenário do guia: ${plan.decision.decision.title}` : plan.continuation ? `Sequência prevista pelo guia: ${plan.continuation.title}` : "Valor local da ação"), plan.components));

    plans.sort((a, b) => b.score - a.score);
    const acceptable = this.difficulty === "easy" ? plans.filter((p) => p.score >= plans[0].score - 20).slice(0, 3) : plans.slice(0, 1);
    const chosen = acceptable[Math.floor(this.random() * acceptable.length)];
    if (chosen.source === "route") {
      const response = profileResponse(ctx, this.planner, BOT_POLICIES[this.difficulty]);
      if (response) { this.decisionSource = "route"; return response; }
    }
    return this.commit(chosen);
  }

  /**
   * Quanto vale esta Invocação-Especial.
   *
   * Três casos bem diferentes chegam pela mesma lista:
   *
   * - **procedimento da mão** (Cyber Dragon, Bode Expiatório, os Fusion via
   *   Metamorfose no Goat): quase sem custo — vem antes da Normal, que é única
   *   por turno;
   * - **Invocação-Pêndulo**, oferecida pela carta na escala (zona de magia):
   *   monstros de graça;
   * - **Extra Deck** (Sincro, Xyz, Link): custa os materiais, e o bot antigo a
   *   fazia sempre — trocava um Battle Ox de 1700 por um Link 1 de 300.
   */
  private scoreSpecialSummon(
    card: OcgCardLoc,
    ctx: BotContext,
    mine: BoardPlayer,
  ): number {
    const intel = readIntel(card.code, ctx.cardDb);
    if (card.location === OcgLocation.SZONE) return PENDULUM_SUMMON_SCORE;
    if (card.location === OcgLocation.EXTRA) return this.scoreExtraDeckSummon(intel, ctx, mine);
    if (this.difficulty === "hard" && (card.code === 83965310 || card.code === 17132130)) {
      const tributos = ocupadas(mine.monsters).map((monster) => ownValue(monster, ctx.cardDb))
        .sort((a, b) => a - b).slice(0, 3);
      if (tributos.length === 3) {
        const custo = tributos.reduce((sum, value) => sum + value, 0);
        const foe = ctx.readBoard(false).players[1 - ctx.me];
        const ameacas = ocupadas(foe.monsters);
        const melhor = Math.max(0, ...ameacas.map((monster) => threatOf(monster, ctx.cardDb)));
        // Plasma rouba e nega monstros; Dogma tem 3400 ATK e cobra metade
        // dos PV no próximo turno. Ambos gastam três corpos de imediato.
        const ganho = card.code === 83965310
          ? 1900 + Math.min(melhor, 3000) * 0.8 + ameacas.length * 350
          : 3400 + Math.min(ctx.lifePoints[1 - ctx.me], 8000) * 0.15
            + (melhor > 0 && melhor < 3400 ? 350 : 0);
        if (custo > ganho + 600) return -1;
      }
    }
    return 104 + Math.min(intel.atk, 3000) / 300
      + (this.planner.openingReady(card.code, mine) ? 22 : 0);
  }

  /**
   * Vale trocar os materiais por este monstro do Extra Deck?
   *
   * O core ainda não disse QUAIS materiais vai pedir — isso vem depois, num
   * SELECT_CARD em que o bot entrega os de menor valor. Aqui a conta usa os
   * mesmos: os `n` monstros mais baratos do campo, onde `n` é o Link Rating
   * (Link) ou 2 (Sincro e Xyz, o caso de quase todos). Os materiais de Xyz
   * pesam menos: ficam presos ao monstro e alimentam o efeito dele.
   */
  private scoreExtraDeckSummon(
    intel: CardIntel,
    ctx: BotContext,
    mine: BoardPlayer,
  ): number {
    const onField = ocupadas(mine.monsters);
    // Um Link-1 que substitui outro Link-1 não aumenta o campo por si só.
    // O guia pode recomendar um desses monstros, mas não transforma cada
    // troca seguinte numa jogada obrigatória. Uma decisão contextual explícita
    // ainda pode autorizá-la depois que o motor a oferece.
    if (intel.isLink && intel.linkRating === 1 && onField.length === 1) {
      const material = onField[0].code === null ? null : readIntel(onField[0].code, ctx.cardDb);
      if (material?.isLink && material.linkRating === 1) return -1;
    }
    const materiais = intel.isLink ? Math.max(1, intel.linkRating) : 2;
    const valores = onField
      .map((c) => ownValue(c, ctx.cardDb))
      .sort((a, b) => a - b);
    let custo = 0;
    for (let i = 0; i < materiais; i += 1) custo += valores[i] ?? OFF_FIELD_MATERIAL;
    if (intel.isXyz) custo *= 0.75;

    // Efeito vale mais que os números — é quase sempre o motivo de existir
    // do monstro do Extra Deck.
    const valor = intel.atk + (intel.isEffect ? 600 : 0)
      + (this.planner.guide?.extra.includes(intel.code) ? 1200 : 0);
    const ganho = valor - custo;
    if (ganho < EXTRA_DECK_MIN_GAIN) return -1;
    return 100 + Math.min(ganho, 3000) / 300;
  }

  /**
   * Quanto vale pôr este Pêndulo da mão numa escala.
   *
   * Escala só serve se abrir uma faixa com monstro da mão para invocar: as
   * duas escalas (a do campo, ou outro Pêndulo da mão) precisam ter algum
   * monstro de Nível **estritamente** entre elas. Sem isso o bot gastava o
   * Pêndulo como uma magia sem efeito, em vez de invocá-lo.
   */
  private scorePendulumScale(
    card: OcgCardLoc,
    intel: CardIntel,
    ctx: BotContext,
    mine: BoardPlayer,
  ): number {
    const naMao = mine.hand
      .map((c) => c.code)
      .filter((code): code is number => code !== null && code > 0);
    // Tira da mão a própria carta (uma cópia só).
    const resto = [...naMao];
    const propria = resto.indexOf(card.code);
    if (propria >= 0) resto.splice(propria, 1);

    const invocaveis = (a: number, b: number, sem: number | null) => {
      const [baixo, alto] = a < b ? [a, b] : [b, a];
      let removida = false;
      return resto.filter((code) => {
        if (!removida && code === sem) {
          removida = true;
          return false;
        }
        const outro = readIntel(code, ctx.cardDb);
        return (
          outro.isMonster &&
          !outro.isExtraDeck &&
          outro.level > baixo &&
          outro.level < alto
        );
      }).length;
    };

    const escalaNoCampo = [mine.spells[0], mine.spells[4]]
      .map((c) => c?.scales?.left ?? null)
      .find((escala) => escala !== null);
    if (escalaNoCampo !== undefined && escalaNoCampo !== null) {
      return invocaveis(intel.scale, escalaNoCampo, null) > 0 ? 118 : -1;
    }
    // Primeira escala: vale se outro Pêndulo da mão fechar uma faixa útil.
    const fecha = resto.some((code) => {
      const outro = readIntel(code, ctx.cardDb);
      return outro.isPendulum && invocaveis(intel.scale, outro.scale, code) > 0;
    });
    return fecha ? 108 : -1;
  }

  /**
   * Quanto vale ativar esta carta agora.
   *
   * @returns nota positiva para ativar; `-1` para "não é hora".
   */
  private scoreActivation(
    card: OcgCardLocActive,
    ctx: BotContext,
    mine: BoardPlayer,
    foe: BoardPlayer,
    antesDaBatalha = false,
  ): number {
    const usos = this.activations.get(chave(card, this.tacticalModel)) ?? 0;
    if (usos >= SAME_CARD_ACTIVATIONS) return -1;

    const value = effectValue(card, ctx);
    if (value !== null) return value;

    if (card.code === 44146295) return mirrorjadeScore(ctx, BOT_POLICIES[this.difficulty]);

    const intel = readIntel(card.code, ctx.cardDb);
    if (this.difficulty === "hard" && intel.isSpell
      && mine.monsters.some((monster) => monster?.code === 26964762 && !monster.negated && !monster.faceDown)) return -1;
    // Pêndulo da mão "ativado" é a carta indo para a escala, não um efeito.
    if (card.location === OcgLocation.HAND && intel.isPendulum && intel.isMonster) {
      return this.scorePendulumScale(card, intel, ctx, mine);
    }
    const role = roleOf(card.code);
    const meusMonstros = ocupadas(mine.monsters);
    const monstrosDele = ocupadas(foe.monsters);
    const backrowDele = ocupadas(foe.spells).length;

    // Espada Quebrada troca também uma carta própria. Se ela é a única carta
    // nossa, destruir a si mesma só continua a linha quando há dois Cavaleiros
    // de mesmo Nível que irão ao Cemitério (materiais + Cemitério atual).
    // Sem esse retorno, não entregue uma Xyz de 2000 por um alvo pequeno.
    if (this.difficulty === "hard" && card.code === 62709239 && card.location === OcgLocation.MZONE
      && meusMonstros.length === 1 && mine.spells.every((spell) => !spell) && !mine.field) {
      const xyz = meusMonstros[0];
      const recursos = [...xyz.overlays, ...mine.grave.map((graveCard) => graveCard.code)].filter((code): code is number => code !== null);
      const nivel3 = recursos.filter((code) => code === 90432163 || code === 36426778 || code === 63821877).length;
      const nivel4 = recursos.filter((code) => code === 99315585 || code === 36704180).length;
      const melhorAlvo = Math.max(0, ...monstrosDele.map((monster) => threatOf(monster, ctx.cardDb)));
      if (nivel3 < 2 && nivel4 < 2 && melhorAlvo < 2200) return -1;
    }

    // As faixas importam tanto quanto os números: **tudo que dá vantagem de
    // carta fica acima de qualquer invocação**. Comprar antes de invocar não é
    // preferência de estilo — é ver duas cartas a mais antes de escolher qual
    // monstro entra, e a Invocação-Normal é uma só por turno. Com as faixas
    // sobrepostas o bot invocava um Battle Ox com o Pote da Ganância parado na
    // mão, decidindo o turno com menos informação do que já tinha à mão.
    switch (role) {
      case "draw":
        return 150;
      case "handRip":
        return foe.hand.length > 0 ? 145 : -1;
      case "revive":
        // Só vale com monstro no cemitério — e o cemitério guarda magia usada
        // também, então contar cartas não basta.
        return mine.grave.some((c) => this.ehMonstro(c, ctx)) ? 130 : -1;
      case "steal":
        return monstrosDele.length > 0 ? 128 : -1;
      case "massRemoval": {
        // Raigeki só leva os monstros adversários; Buraco Negro leva ambos.
        const meu = meusMonstros.reduce((t, c) => t + ownValue(c, ctx.cardDb), 0);
        const dele = monstrosDele.reduce((t, c) => t + threatOf(c, ctx.cardDb), 0);
        return dele > (card.code === RAIGEKI ? 0 : meu + 300) ? 126 : -1;
      }
      case "spotRemoval":
        if (monstrosDele.length === 0) return -1;
        if (card.code === RING_OF_DESTRUCTION) {
          // O dano bate nos dois: só com folga de LP sobre o adversário.
          const meuLp = ctx.lifePoints[ctx.me];
          const alvo = Math.max(
            ...monstrosDele.map((c) => knownStats(c)?.attack ?? 0),
          );
          if (meuLp - alvo <= 0) return -1;
          return meuLp > ctx.lifePoints[1 - ctx.me] ? 124 : -1;
        }
        return 122;
      case "backrowNuke": {
        // Espanador só limpa o lado adversário. Tempestade Pesada também
        // destrói as próprias cartas; a carta ativada já foi gasta na troca.
        const meuBackrow = ocupadas(mine.spells).filter((c) =>
          !(card.location === OcgLocation.SZONE && c.sequence === card.sequence)).length;
        if (card.code === HARPIES_FEATHER_DUSTER) return backrowDele > 0 ? 118 : -1;
        return backrowDele >= 2 && backrowDele > meuBackrow ? 118 : -1;
      }
      case "backrowSpot":
        return backrowDele >= 1 ? 58 : -1;
      case "stall": {
        const meu = meusMonstros.reduce((t, c) => t + ownValue(c, ctx.cardDb), 0);
        const dele = monstrosDele.reduce((t, c) => t + threatOf(c, ctx.cardDb), 0);
        return dele > meu ? 56 : -1;
      }
      case "battleTrap":
        // O lugar dela é a corrente, respondendo a um ataque — nunca a Main.
        return -1;
      default:
        break;
    }

    // Armadilha na mão não se ativa na Main; a que já está no campo o core
    // oferece pela corrente, não por aqui.
    if (intel.isTrap) return -1;

    // Para listas com guia editorial, a carta central ganha prioridade quando
    // o motor já confirmou que sua ativação é legal. Isto não força a sequência
    // textual: as ameaças visíveis e os efeitos de remoção continuam acima.
    if (this.planner.guide?.core.includes(card.code) && !intel.isQuickplay) {
      const opening = this.planner.openingReady(card.code, mine);
      if (intel.isMonster) return opening ? 120 : 92;
      if (intel.isSpell) return opening ? 116 : 86;
    }

    // Main Phase 1 com ataque à vista: o que a carta faz precisa acontecer
    // ANTES da batalha. Com as notas antigas (46–64, abaixo dos 76 de "vale
    // atacar") o bot ia para a Battle Phase com a Polimerização, o
    // equipamento e o efeito de ignição ainda parados, e só os jogava na Main
    // 2 — depois dos ataques que eles teriam mudado. O core só oferece o que
    // é legal agora; magia rápida continua guardada (o lugar dela é o turno
    // do oponente).
    if (antesDaBatalha && !intel.isQuickplay) {
      if (intel.isEquip) return meusMonstros.length > 0 ? 80 : -1;
      if (intel.isMonster) return 79;
      if (intel.isField) return 79;
      if (intel.isContinuous) return 77;
      if (intel.isSpell) return 78;
    }

    if (intel.isEquip) return meusMonstros.length > 0 ? 62 : -1;
    if (intel.isField) return 54;
    if (intel.isContinuous) return 50;
    if (intel.isMonster) return 64;
    if (intel.isSpell) return 46;
    return 40;
  }

  private ehMonstro(card: BoardCard, ctx: BotContext): boolean {
    if (card.code === null) return false;
    return readIntel(card.code, ctx.cardDb).isMonster;
  }

  /**
   * Quanto vale invocar este monstro em posição de ataque.
   *
   * O que o bot antigo não fazia: comparar. Ele invocava `summons[0]` — a
   * primeira carta da mão que coubesse — e, se ela fosse de nível 7, tributava
   * dois monstros melhores para pôr no lugar um corpo pior.
   */
  private scoreSummon(
    card: OcgCardLoc,
    ctx: BotContext,
    mine: BoardPlayer,
  ): number {
    // Anjo Negro é uma interrupção para o campo adversário, não uma abertura
    // de 0 ATK: no nosso campo ele ainda nega as nossas próprias Magias.
    if (this.decisionGuide?.id === "tcg-lehd-destiny-hero" && card.code === 26964762) return -1;
    if (this.difficulty !== "easy" && this.planner.reserves.includes(card.code)
      && mine.hand.filter((c) => c.code === card.code).length <= 1) return -1;
    if (this.difficulty === "easy" && this.planner.starters.includes(card.code)) return 115;
    const intel = readIntel(card.code, ctx.cardDb);
    if (this.decisionGuide?.id === "tcg-lehd-destiny-hero") {
      if (card.code === 63060238) return 112; // Homem em Chamas busca Polimerização.
      if (card.code === 13093792) return 91; // Homem Diamante precisa ficar virado para cima.
    }
    // Invocar em ataque um monstro que só tem defesa é entregá-lo.
    if (intel.atk < intel.def && intel.atk < 1500) return -1;

    // Teto de 100: o ATK ordena os monstros entre si, não compete com o Pote
    // da Ganância. Sem o teto, um monstro de 2500 valia mais que comprar duas
    // cartas — e o bot decidia o turno inteiro às cegas para pôr um corpo a
    // mais no campo.
    let score = 70 + Math.min(intel.atk, 3000) / 100;

    if (intel.tributes > 0) {
      // Os tributos saem dos monstros de menor valor — é o que o próprio bot
      // vai escolher em SELECT_TRIBUTE.
      const custo = ocupadas(mine.monsters)
        .map((c) => ownValue(c, ctx.cardDb))
        .sort((a, b) => a - b)
        .slice(0, intel.tributes)
        .reduce((total, valor) => total + valor, 0);
      score -= custo / 120 + intel.tributes * 8;
    }

    if (intel.tributes === 0 && this.planner.openingReady(card.code, mine)) score += 40;

    return score;
  }

  /** Quanto vale baixar este monstro virado para baixo. */
  private scoreSet(card: OcgCardLoc, ctx: BotContext): number {
    if (this.decisionGuide?.id === "tcg-lehd-destiny-hero" && card.code === 26964762) return -1;
    if (this.difficulty !== "easy" && this.planner.reserves.includes(card.code)) return -1;
    const intel = readIntel(card.code, ctx.cardDb);
    if (intel.tributes > 0) return -1;

    let score = 46 + Math.min(intel.def, 3000) / 120;
    // Flip effect setado é a jogada que define o formato: o efeito dispara
    // justamente quando o oponente ataca, e o corpo ainda bloqueia.
    if (intel.isFlip) score += 22;
    // Corpo grande de ataque não deveria estar deitado.
    if (intel.atk >= 1700 && intel.atk > intel.def) score -= 20;
    return score;
  }

  /**
   * Quanto vale baixar esta carta na zona de magia/armadilha.
   *
   * Aqui mora o erro que quase perde o duelo sozinho: são **cinco** zonas, e
   * elas servem tanto para as armadilhas quanto para toda magia contínua, de
   * equipamento e de campo que o bot venha a comprar. Uma regra de "baixar é
   * bom" esvazia a mão no primeiro turno, entope as cinco com o que havia de
   * pior e desliga o bot pelo resto da partida — o core simplesmente para de
   * oferecer jogada, porque não há onde pôr nada. Foi o que apareceu no duelo
   * narrado: cinco armadilhas do Starter Deck no turno 2, e trinta turnos
   * seguidos sem uma única jogada depois disso.
   *
   * Daí as três travas: baixar poucas por turno, guardar uma zona de folga, e
   * só gastar a zona com carta que realmente muda um combate.
   */
  private scoreBackrowSet(
    card: OcgCardLoc,
    ctx: BotContext,
    zonasLivres: number,
  ): number {
    // Despejar a mão entrega tudo de uma vez a uma Tempestade Pesada, e não
    // sobra resposta para o turno seguinte.
    if (this.setsNoTurno >= 2) return -1;

    const intel = readIntel(card.code, ctx.cardDb);
    // Magia normal baixada não ganha nada: ela só poderia ser ativada no
    // próprio turno do bot, que é quando ele já podia tê-la ativado da mão.
    if (!intel.isTrap && !intel.isQuickplay) return -1;

    const role = roleOf(card.code);
    const decideCombate =
      role === "battleTrap" || role === "spotRemoval" || role === "massRemoval";

    // A última zona fica de reserva para a magia contínua/de campo que vier —
    // a não ser que a carta na mão seja das que ganham o combate sozinhas.
    if (zonasLivres - this.setsNoTurno <= 1 && !decideCombate) return -1;

    if (decideCombate) return 64;
    // Contra-armadilha baixada agora sai na hora certa (`scoreCounter`): vale
    // a zona antes de uma armadilha qualquer.
    if (intel.isCounter) return 52;
    if (role === "backrowSpot") return 48;
    return intel.isTrap ? 40 : 34;
  }

  private scorePosChange(
    card: OcgCardLoc,
    ctx: BotContext,
    mine: BoardPlayer,
    foe: BoardPlayer,
  ): number {
    const atual = mine.monsters[card.sequence];
    if (!atual) return -1;
    const intel = readIntel(card.code, ctx.cardDb);
    const stats = knownStats(atual);
    const atk = stats?.attack ?? intel.atk;
    const def = stats?.defense ?? intel.def;

    const maior = Math.max(
      0,
      ...ocupadas(foe.monsters).map((c) => knownStats(c)?.attack ?? 0),
    );

    if (atual.defense) {
      // De pé só se puder atacar sem morrer.
      const { score } = appraiseAttack(atk, ocupadas(foe.monsters).length === 0, foe, this.tacticalModel);
      return score > 0 ? 34 : -1;
    }
    // Deitar quando o campo dele passa por cima de mim e a defesa segura mais.
    return maior > atk && def > atk ? 32 : -1;
  }

  /** Vale a pena abrir a Battle Phase? */
  private battlePhaseValue(mine: BoardPlayer, foe: BoardPlayer): number {
    const semDefesa = ocupadas(foe.monsters).length === 0;
    let melhor = -Infinity;
    for (const card of ocupadas(mine.monsters)) {
      if (card.defense || card.faceDown) continue;
      const atk = knownStats(card)?.attack ?? 0;
      const { score } = appraiseAttack(atk, semDefesa, foe, this.tacticalModel);
      melhor = Math.max(melhor, score);
    }
    // Sem ataque que valha, a Battle Phase ainda é melhor que a End Phase: dá
    // Main Phase 2. Só não vale gastar a jogada da Main 1 por ela.
    return melhor > 0 ? 76 : 18;
  }

  // ── Battle Phase ───────────────────────────────────────────────────────

  private battle(
    message: OcgMessageSelectBattleCMD,
    ctx: BotContext,
  ): OcgResponse {
    this.battleSteps += 1;
    const cmd = (action: SelectBattleCMDAction, index: number | null) =>
      ({ type: OcgResponseType.SELECT_BATTLECMD, action, index }) as OcgResponse;
    const encerrar = () => {
      if (message.to_m2) return cmd(SelectBattleCMDAction.TO_M2, null);
      if (message.to_ep) return cmd(SelectBattleCMDAction.TO_EP, null);
      // Nem Main 2 nem End Phase oferecidas: algum efeito obriga a atacar
      // (visto com o Dark Eradicator Warlock do SD6). Pedir a End Phase assim
      // era resposta inválida — RETRY até o duelo ser interrompido. Ataca com
      // o primeiro que puder; o alvo sai do SELECT_CARD de sempre.
      if (message.attacks.length > 0) return cmd(SelectBattleCMDAction.SELECT_BATTLE, 0);
      if (message.chains.length > 0) return cmd(SelectBattleCMDAction.SELECT_CHAIN, 0);
      return cmd(SelectBattleCMDAction.TO_EP, null);
    };

    if (this.battleSteps > BATTLE_BUDGET) return encerrar();

    const board = ctx.readBoard(false);
    const [mine, foe] = lados(board, ctx.me);

    type BattlePlan = Plan & { target: BoardCard | null; traceId?: string };
    const record = (plan: BattlePlan, expected = "Avaliar dano e campo restante", confidence: BotCandidateTrace["confidence"] = "heuristic"): BattlePlan => {
      const candidate = this.candidate(ctx, plan.response, plan.score, plan.source ?? "heuristic", expected);
      candidate.expected = expected;
      candidate.confidence = confidence;
      candidate.id += `:target=${plan.target?.sequence ?? "direct"}:${this.candidates.length}`;
      candidate.targets = plan.target?.code ? [{ code: plan.target.code, controller: plan.target.controller,
        location: plan.target.location, sequence: plan.target.sequence, description: null }] : [];
      this.candidates.push(candidate);
      return { ...plan, traceId: candidate.id };
    };
    let melhor: BattlePlan | null = null;
    const stop = encerrar();
    if (validBotResponse(message, stop, ctx.cardDb)) record({ score: 0, response: stop, target: null }, "Encerrar batalha e preservar o campo");
    const planned = planBattle(message, ctx, BOT_POLICIES[this.difficulty], this.deadline);
    if (planned) melhor = record({ score: planned.score,
      response: cmd(SelectBattleCMDAction.SELECT_BATTLE, planned.index), target: planned.target },
      planned.lethal === "modeled" ? "Letal demonstrado nos efeitos cobertos" : planned.lethal === "uncertain" ? "Tentativa de letal sob incerteza" : "Ordem de ataques e campo restante",
      planned.lethal === "modeled" ? "modeled" : planned.lethal === "uncertain" ? "unknown" : "heuristic");

    message.chains.forEach((card, index) => {
      const guided = this.slifer?.effect(card, ctx) ?? this.hero?.effect(card, ctx) ?? this.phantom?.effect(card, ctx);
      const score = (effectValue(card, ctx) ?? 1) <= 0 ? -1 : guided?.score ?? this.scoreActivation(card, ctx, mine, foe);
      const option = record({
          score,
          response: cmd(SelectBattleCMDAction.SELECT_CHAIN, index),
          activated: card,
          target: null,
          lessonId: guided?.lessonId,
          source: guided ? "guide" : undefined,
        }, guided?.reason ?? "Ativar efeito na batalha");
      if (score > 0 && (!melhor || score > melhor.score)) melhor = option;
    });

    message.attacks.forEach((card, index) => {
      const meu =
        card.location === OcgLocation.MZONE ? mine.monsters[card.sequence] : null;
      const atk =
        (meu ? knownStats(meu)?.attack : null) ??
        readIntel(card.code, ctx.cardDb).atk;
      const { score, target } = appraiseAttack(atk, card.can_direct, foe, this.tacticalModel);
      const option = record({
          score,
          response: cmd(SelectBattleCMDAction.SELECT_BATTLE, index),
          target,
        }, "Dano e risco do ataque local");
      if (score > 0 && (!melhor || score > melhor.score)) melhor = option;
    });

    if (!melhor) return encerrar();

    const escolhido = melhor as BattlePlan;
    this.chosenCandidateId = escolhido.traceId ?? null;
    // Guardado para o SELECT_CARD em que o core pergunta quem apanha.
    this.plannedTarget = escolhido.target
      ? {
          controller: escolhido.target.controller,
          sequence: escolhido.target.sequence,
          code: escolhido.target.code,
        }
      : null;
    return this.commit(escolhido);
  }

  // ── Corrente ───────────────────────────────────────────────────────────

  private chain(
    message: OcgMessageSelectChain,
    ctx: BotContext,
  ): OcgResponse {
    const responder = (index: number | null) =>
      ({ type: OcgResponseType.SELECT_CHAIN, index }) as OcgResponse;

    if (message.selects.length === 0) return responder(null);
    // Recusar uma corrente forçada é resposta inválida — o core devolve RETRY.
    if (message.forced) { this.decisionSource = "fallback-unmodeled"; return responder(0); }

    this.chainSteps += 1;
    if (this.chainSteps > CHAIN_BUDGET) return responder(null);

    const board = ctx.readBoard(false);
    const [mine, foe] = lados(board, ctx.me);

    let melhorIndex: number | null = null;
    let melhorScore = CHAIN_THRESHOLD;
    let lessonId: string | null = null;

    message.selects.forEach((card, index) => {
      const guided = this.slifer?.effect(card, ctx) ?? this.hero?.effect(card, ctx) ?? this.phantom?.effect(card, ctx);
      const score = (effectValue(card, ctx) ?? 1) <= 0 ? -1 : guided?.score ?? this.scoreChain(card, ctx, mine, foe);
      this.candidates.push(this.candidate(ctx, responder(index), score, guided ? "guide" : "heuristic", guided?.reason));
      this.candidates.push(this.candidate(ctx,{type:OcgResponseType.SELECT_UNSELECT_CARD,index},score,"heuristic","Custo marginal do material selecionável"));
      if (score > melhorScore) {
        melhorScore = score;
        melhorIndex = index;
        lessonId = guided?.lessonId ?? null;
      }
    });
    this.candidates.push(this.candidate(ctx, responder(null), CHAIN_THRESHOLD, "heuristic", "Guardar interação para outra janela"));

    if (melhorIndex === null) return responder(null);
    if (lessonId) { this.guideLesson = lessonId; this.decisionSource = "guide"; }
    this.noteActivation(message.selects[melhorIndex]);
    return responder(melhorIndex);
  }

  /**
   * Quanto vale responder com esta carta.
   *
   * A premissa que sustenta as notas: **o core só oferece o que é legal ativar
   * naquele instante**. As condições da carta ("quando um monstro declarar um
   * ataque", "quando uma magia for ativada") já foram conferidas pelo script
   * antes de a opção aparecer. Então a pergunta que sobra não é "posso?", é
   * "gasto agora ou guardo?" — e guardar armadilha para o próprio turno, onde
   * ela quase nunca serve, é o erro que custa o duelo.
   */
  private scoreChain(
    card: OcgCardLoc,
    ctx: BotContext,
    mine: BoardPlayer,
    foe: BoardPlayer,
  ): number {
    const usos = this.activations.get(chave(card, this.tacticalModel)) ?? 0;
    if (usos >= SAME_CARD_ACTIVATIONS) return -1;

    const value = effectValue(card, ctx);
    if (value !== null) return value;

    if (card.code === 44146295) {
      if ("description" in card && (card.description as bigint) === (44146295n << 20n) + 1n) return 100;
      return mirrorjadeScore(ctx, BOT_POLICIES[this.difficulty]);
    }

    const intel = readIntel(card.code, ctx.cardDb);
    if (this.difficulty === "hard" && intel.isSpell
      && mine.monsters.some((monster) => monster?.code === 26964762 && !monster.negated && !monster.faceDown)) return -1;
    const role = roleOf(card.code);
    // Sem informação de turno, presume o do adversário: é onde uma armadilha
    // oferecida quase sempre está, e errar para o lado de responder custa uma
    // carta — errar para o lado de guardar custa o duelo.
    const turnoDele = ctx.turnPlayer === null || ctx.turnPlayer !== ctx.me;
    const monstrosDele = ocupadas(foe.monsters);
    const eloMeu = ctx.chainPlayer === ctx.me;
    const eloDele = ctx.chainPlayer !== undefined && ctx.chainPlayer !== null && ctx.chainPlayer !== ctx.me;

    // Kagemucha é uma extensão da própria Invocação-Normal, não uma hand trap.
    // O cenário do Aprender ensina essa sequência mesmo quando não há rota
    // completa do perfil (por exemplo, sem Botas na mão inicial).
    if (card.code === 19353570 && card.location === OcgLocation.HAND
      && ctx.turnPlayer === ctx.me && this.decisionGuide?.decisions.some((d) => d.id === "kagemucha-sem-botas")
      && mine.monsters.some((monster) => monster?.code && readIntel(monster.code, ctx.cardDb).level === 3)) return 110;

    // Hand trap — efeito de monstro ativado DA MÃO. Nunca contra o próprio
    // elo: a Ash Blossom pega qualquer "adicionar do Deck", inclusive o do
    // bot, e ele negava a própria busca. Fora disso, é a resposta ao
    // adversário: vale contra um elo dele, no turno dele, ou na batalha
    // (Kuriboh, Honest). No próprio turno sem nada dele em jogo, guarda.
    if (card.location === OcgLocation.HAND && intel.isMonster) {
      if (eloMeu) return -1;
      if (this.tacticalModel && this.difficulty !== "easy") {
        const timing = interruptionValue(card, ctx);
        if (timing !== null) return timing;
      }
      const naBatalha = ctx.phase !== null && (ctx.phase & BATTLE_PHASES) !== 0;
      return eloDele || turnoDele || naBatalha ? 72 : -1;
    }
    // Contra-armadilha no próprio elo negaria a própria carta.
    if (intel.isCounter && eloMeu) return -1;

    switch (role) {
      case "battleTrap":
        // Sem condição de fase: a Força do Espelho só entra na lista quando um
        // ataque **já foi declarado** — quem confere isso é o script da carta,
        // dentro do core. Repetir a checagem aqui, contra uma fase que o
        // contexto pode não ter, só cria um jeito de o bot recusar a carta no
        // único instante em que ela serve.
        return 98;
      case "spotRemoval":
        if (monstrosDele.length === 0) return -1;
        if (card.code === RING_OF_DESTRUCTION) {
          const alvo = Math.max(0, ...monstrosDele.map((c) => knownStats(c)?.attack ?? 0));
          return ctx.lifePoints[ctx.me] - alvo > 0 &&
            ctx.lifePoints[ctx.me] > ctx.lifePoints[1 - ctx.me]
            ? 88
            : -1;
        }
        return 90;
      case "massRemoval": {
        const meu = ocupadas(mine.monsters).reduce(
          (t, c) => t + ownValue(c, ctx.cardDb),
          0,
        );
        const dele = monstrosDele.reduce((t, c) => t + threatOf(c, ctx.cardDb), 0);
        return dele > (card.code === RAIGEKI ? 0 : meu + 300) ? 87 : -1;
      }
      case "backrowSpot":
        return ocupadas(foe.spells).length >= 1 ? 56 : -1;
      case "draw":
        return 80;
      case "stall":
      case "handRip":
      case "backrowNuke":
      case "revive":
      case "steal":
        return 50;
      default:
        break;
    }

    if (intel.isCounter) return this.scoreCounter(card, ctx, mine);
    // Efeito de monstro que o core ofereceu na corrente costuma ser um gatilho
    // de graça — o custo, se houver, já foi cobrado pelo script.
    if (intel.isMonster) return 62;
    if (intel.isTrap) return turnoDele ? 55 : 25;
    if (intel.isQuickplay) return turnoDele ? 52 : 34;
    return turnoDele ? 48 : 30;
  }

  /**
   * Quanto vale gastar esta contra-armadilha agora: o que ela nega menos o
   * que ela cobra.
   *
   * Antes a nota era fixa (30, abaixo do limiar de 45) — sem saber o que
   * estava sendo negado, guardar parecia o menor arrependimento. Na prática
   * era guardar para sempre: o Julgamento Solene ocupava uma zona o duelo
   * inteiro e via passar o Jinzo, o Roubar e a Força do Espelho.
   *
   * O alvo de uma contra-armadilha é sempre uma de duas coisas, e o core só a
   * oferece quando o script dela aceita aquela:
   *
   * - **o último elo da corrente** (Bloqueador de Magia, Sete Ferramentas, o
   *   Julgamento contra uma magia/armadilha) — vale o que a carta do elo faz;
   * - **a Invocação em andamento**, com a corrente vazia (Julgamento Solene,
   *   Aviso Solene, Corneta Celestial) — vale o monstro que está entrando.
   *
   * A conta fica na mesma régua do limiar (45): o Julgamento (−20) nega a
   * Invocação-Tributo de um Summoned Skull (77) mas deixa passar um Battle Ox
   * (42); o Bloqueador de Magia (−25) nega o Roubar (95) e deixa o Pote da
   * Ganância (60) — trocar a contra e o descarte por uma compra de dois é
   * dar duas cartas por uma.
   */
  private scoreCounter(card: OcgCardLoc, ctx: BotContext, mine: BoardPlayer): number {
    const custo = this.counterCost(card.code, ctx, mine);
    const eloDele =
      ctx.chainPlayer !== undefined && ctx.chainPlayer !== null && ctx.chainPlayer !== ctx.me;
    // Com corrente aberta, o que se nega é o elo — mesmo que haja uma
    // Invocação por trás dele.
    if (eloDele) {
      if (ctx.chainCode === undefined || ctx.chainCode === null) return -1;
      return this.activationThreat(ctx.chainCode, ctx, mine) - custo;
    }
    const invocacao = ctx.summoning ?? null;
    // Corrente vazia e Invocação do próprio bot: o core oferece a contra aos
    // dois jogadores, e aceitar negaria o próprio monstro.
    if (invocacao === null || invocacao.player === ctx.me) return -1;
    return this.summonThreat(invocacao.code, ctx) - custo;
  }

  /**
   * O quanto dói deixar resolver esta carta do adversário.
   *
   * Pelo papel quando a carta é conhecida (`CARD_ROLES`); sem papel, só o tipo
   * — baixo de propósito, para uma contra que cobra alguma coisa nunca sair
   * contra uma carta que o bot não sabe o que faz.
   */
  private activationThreat(code: number, ctx: BotContext, mine: BoardPlayer): number {
    switch (roleOf(code)) {
      // Leva um monstro meu para o lado dele: perco um, ele ganha um.
      case "steal":
        return 95;
      // Tempestade Pesada e Espanador levam a própria contra-armadilha junto:
      // ou ela é usada agora, ou vai para o cemitério sem fazer nada.
      case "backrowNuke":
        return 95;
      case "massRemoval": {
        // Só dói se houver o que perder do meu lado.
        const meu = ocupadas(mine.monsters).reduce((t, c) => t + ownValue(c, ctx.cardDb), 0);
        return meu >= 1000 ? 95 : -1;
      }
      // Remoção pontual do adversário aponta para um monstro meu — qual, o
      // bot não sabe (a Fissura leva o de menor ATK, o Nobre um virado): vale
      // pelo melhor que está em jogo. Negar a Fissura num Sangan com o
      // Bloqueador de Magia é dar duas cartas para salvar uma que não pesa.
      case "spotRemoval": {
        if (this.difficulty === "hard" && ctx.chainTargets?.length) {
          const threatened = ctx.chainTargets.filter((t) => t.present && t.controller === ctx.me && t.location === OcgLocation.MZONE)
            .map((t) => mine.monsters[t.sequence]).filter((c): c is BoardCard => c !== null && c !== undefined);
          if (threatened.length) return 55 + Math.min(3000, Math.max(...threatened.map((c) => ownValue(c, ctx.cardDb)))) / 100;
        }
        const melhor = Math.max(0, ...ocupadas(mine.monsters).map((c) => ownValue(c, ctx.cardDb)));
        return 55 + Math.min(melhor, 3000) / 100;
      }
      // Armadilha de combate dele responde a um ataque meu: a Força do
      // Espelho e a Armadura levam monstros; o Waboku só segura o ataque.
      case "battleTrap":
        return FOG_TRAPS.has(code) ? 50 : 85;
      case "revive":
      case "stall":
        return 80;
      // Quase sempre aponta para uma carta baixada minha — talvez a própria.
      case "backrowSpot":
        return 70;
      case "handRip":
        return 65;
      case "draw":
        return 60;
      default:
        break;
    }
    const intel = readIntel(code, ctx.cardDb);
    // Contra-armadilha dele negando uma carta minha: negar a dela salva a minha.
    if (intel.isCounter) return 75;
    if (intel.isMonster || intel.isEquip) return 55;
    return 50;
  }

  /**
   * O quanto dói deixar este monstro entrar — a mesma régua de
   * `activationThreat`.
   *
   * ATK pesa mais (3000 → 75), e há dois bônus: efeito, e monstro "caro"
   * (Nível 5+ ou do Extra Deck), cuja Invocação já consumiu tributos ou
   * materiais — negá-la leva o monstro e o que se pagou por ele.
   */
  private summonThreat(code: number, ctx: BotContext): number {
    const intel = readIntel(code, ctx.cardDb);
    let ameaca = Math.min(intel.atk, 3000) / 40;
    if (intel.isEffect) ameaca += 15;
    if (intel.level >= 5 || intel.isExtraDeck) ameaca += 15;
    return ameaca;
  }

  /**
   * O que a contra-armadilha cobra, na régua das notas.
   *
   * PV pesam pela fração dos que o bot tem: o Julgamento Solene custa sempre
   * metade (−20), as Sete Ferramentas custam pouco com 8000 (−9). Passando
   * da metade a conta acelera — mil de 1050 PV (−61) deixa o bot a um
   * efeito de dano de perder, e foi assim que ele gastou 1000 PV num Waboku.
   * Se não dá para pagar, o core nem oferece a carta.
   *
   * Uma carta pesa mais que mil PV (−25 contra −9): é a moeda do formato.
   */
  private counterCost(code: number, ctx: BotContext, mine: BoardPlayer): number {
    const custo = counterCostOf(code);
    // Desconhecida: um preço médio, entre o de graça e o de uma carta.
    if (custo === null) return 15;
    switch (custo.kind) {
      case "free":
        return 0;
      case "lp": {
        const lp = Math.max(1, ctx.lifePoints[ctx.me]);
        const valor = custo.amount === "half" ? lp / 2 : custo.amount;
        const fracao = Math.min(1, valor / lp);
        return 5 + 30 * fracao + 60 * Math.max(0, fracao - 0.5);
      }
      case "discard":
        return 25;
      case "opponentDraws":
        return 12;
      case "tribute": {
        // Vai o monstro mais barato — é o que o próprio bot entrega no
        // SELECT_TRIBUTE/SELECT_CARD que vem depois.
        const valores = ocupadas(mine.monsters).map((c) => ownValue(c, ctx.cardDb));
        return 10 + (valores.length > 0 ? Math.min(...valores) : 0) / 100;
      }
    }
  }

  // ── Seleções de carta ──────────────────────────────────────────────────

  private selectCard(
    message: OcgMessageSelectCard,
    ctx: BotContext,
  ): OcgResponse | null {
    const candidatos = message.selects;
    if (candidatos.length === 0) return null;

    // Durante os custos/alvos o elo ainda não começou a resolver. A intenção
    // guarda o efeito que escolhemos; durante a resolução o contexto prevalece.
    const effect = ctx.resolvingEffect ?? this.planner.intents.current();
    if (effect && candidatos.every(card => effectTargetValue(effect, card, ctx) !== null)) {
      const ranked = candidatos.map((card, index) => ({ index, score: effectTargetValue(effect, card, ctx)! }))
        .sort((a, b) => b.score - a.score);
      const count = Math.max(message.min, Math.min(message.max, ranked.filter(c => c.score > 0).length));
      return { type: OcgResponseType.SELECT_CARD, indicies: ranked.slice(0, count).map(c => c.index) };
    }

    if (this.pendingDecisionTarget !== null && message.min <= 1 && message.max >= 1) {
      const index = candidatos.findIndex((card) => card.controller === ctx.me && card.code === this.pendingDecisionTarget);
      if (index >= 0) {
        this.pendingDecisionTarget = null;
        return { type: OcgResponseType.SELECT_CARD, indicies: [index] };
      }
    }

    if (this.decisionGuide && this.deck && ctx.resolvingEffect?.player === ctx.me
      && message.min <= 1 && message.max >= 1) {
      const guided = decisionEffectTarget(this.decisionGuide.decisions, ctx.readBoard(true), ctx.me,
        this.deck, ctx.resolvingEffect.code, candidatos);
      if (guided) {
        this.usedGuideDecision = guided.decision.id;
        this.planner.reason = `Cenário do guia: ${guided.decision.title}`;
        return { type: OcgResponseType.SELECT_CARD, indicies: [guided.index] };
      }
    }

    // O alvo do ataque que o bot acabou de escolher.
    if (this.plannedTarget) {
      const alvo = this.plannedTarget;
      this.plannedTarget = null;
      const index = candidatos.findIndex(
        (c) =>
          c.location === OcgLocation.MZONE &&
          c.controller === alvo.controller &&
          (alvo.code === null ? c.code === 0 : c.code === alvo.code) &&
          c.sequence === alvo.sequence,
      );
      if (index >= 0) {
        return { type: OcgResponseType.SELECT_CARD, indicies: [index] };
      }
    }

    const quantos = Math.min(
      Math.max(message.min, 1),
      candidatos.length,
    );
    const board = ctx.readBoard(true);
    const notas = candidatos.map((card, index) => ({
      index,
      score: this.scoreCandidate(card, ctx, board),
    }));
    notas.sort((a, b) => b.score - a.score);
    this.candidates = notas.map(({ index }) => {
      const selected = [notas.find(n => n.index === index)!, ...notas.filter(n => n.index !== index)].slice(0, quantos);
      return this.candidate(ctx, { type: OcgResponseType.SELECT_CARD, indicies: selected.map(n => n.index) },
        selected.reduce((sum,n) => sum+n.score,0), "heuristic", "Valor do alvo e custo de oportunidade");
    }).filter(candidate => validBotResponse(message, candidate.response, ctx.cardDb));

    // Alguns efeitos permitem escolher zero cartas. Se só há custos próprios,
    // uma escolha opcional não deve entregar um recurso sem benefício.
    if (message.min === 0 && notas[0].score <= 0) {
      this.candidates.push(this.candidate(ctx, { type: OcgResponseType.SELECT_CARD, indicies: [] }, 0, "heuristic", "Preservar recurso na seleção opcional"));
      return { type: OcgResponseType.SELECT_CARD, indicies: [] };
    }

    return {
      type: OcgResponseType.SELECT_CARD,
      indicies: notas.slice(0, quantos).map((n) => n.index),
    };
  }

  /**
   * Quanto o bot quer marcar este candidato.
   *
   * Um SELECT_CARD não diz o que vai acontecer com a carta escolhida — o mesmo
   * prompt pede o alvo de uma destruição, a carta a descartar e o monstro a
   * reanimar. O que separa os três é **de quem** e **de onde**: carta do
   * oponente é alvo (quero a melhor dele), carta minha na mão é custo (dou a
   * pior), carta minha no cemitério ou no deck é busca (quero a melhor).
   */
  private scoreCandidate(
    card: OcgCardLoc,
    ctx: BotContext,
    board: BoardState,
  ): number {
    // Anjo Negro no próprio campo anula as nossas Magias, inclusive Mudar a Máscara.
    // Broca-negra só deve estender com ele se o guia trouxer uma rota explícita.
    if (this.decisionGuide?.id === "tcg-lehd-destiny-hero"
      && ctx.resolvingEffect?.player === ctx.me && ctx.resolvingEffect.code === 91691605
      && card.location === OcgLocation.HAND && card.code === 26964762) return -100_000;
    const strategic = this.planner.targetScore(card, ctx);
    if (strategic !== null) return strategic;
    const intel = readIntel(card.code, ctx.cardDb);
    const valor = intel.isMonster
      ? Math.max(intel.atk, intel.def)
      : 1200; // magia/armadilha: valor médio, sem números para comparar

    if (card.controller !== ctx.me) {
      // Carta do adversário: quanto mais forte, mais quero apontar para ela.
      const noCampo =
        card.location === OcgLocation.MZONE
          ? board.players[card.controller].monsters[card.sequence]
          : null;
      return noCampo ? threatOf(noCampo, ctx.cardDb) : valor;
    }

    switch (card.location) {
      case OcgLocation.HAND:
        return -resourceValue(card.code, ctx, this.difficulty === "easy" ? [] : [...this.planner.reserves, ...this.planner.protectedCards],
          this.difficulty === "easy" ? [] : this.planner.starters);
      case OcgLocation.DECK: {
        const hand = board.players[ctx.me].hand;
        const duplicate = hand.some(held => held.code === card.code);
        const alternativeAccess = ctx.prompt.type === OcgMessageType.SELECT_CARD && ctx.prompt.selects.some(other =>
          other.controller === ctx.me && other.location === OcgLocation.DECK && this.planner.starters.includes(other.code)
          && !hand.some(held => held.code === other.code));
        // Outra cópia continua útil quando não existe acesso alternativo. Um
        // alvo contextual do guia é escolhido antes desta regra genérica.
        const isSearch = ctx.resolvingEffect && effectModel(ctx.resolvingEffect.code, ctx.resolvingEffect.description)?.kind === "search";
        const opportunity = this.tacticalModel && isSearch && this.difficulty !== "easy" && duplicate ? alternativeAccess ? 6000 : 600 : 0;
        return valor + (this.planner.starters.includes(card.code) ? 5000 : 0) - opportunity;
      }
      case OcgLocation.GRAVE:
      case OcgLocation.REMOVED:
        // Recuperar: o melhor que houver.
        return valor;
      case OcgLocation.MZONE:
      case OcgLocation.SZONE: {
        // Carta minha em jogo sendo apontada: quase sempre custo (tributo,
        // destruição própria). Entrego a de menor valor.
        const noCampo =
          card.location === OcgLocation.MZONE
            ? board.players[ctx.me].monsters[card.sequence]
            : board.players[ctx.me].spells[card.sequence];
        return -(noCampo ? ownValue(noCampo, ctx.cardDb) : valor);
      }
      default:
        return 0;
    }
  }

  private selectUnselect(
    message: OcgMessageSelectUnselectCard,
    ctx: BotContext,
  ): OcgResponse | null {
    // Nada mais a marcar: insistir num índice aqui é o RETRY em laço.
    if (message.select_cards.length === 0) {
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
    }

    const board = ctx.readBoard(true);
    let melhor = 0;
    let melhorScore = -Infinity;
    message.select_cards.forEach((card, index) => {
      const score = this.scoreCandidate(card, ctx, board);
      this.candidates.push(this.candidate(ctx,{type:OcgResponseType.SELECT_UNSELECT_CARD,index},score,"heuristic","Custo marginal do material selecionável"));
      if (score > melhorScore) {
        melhorScore = score;
        melhor = index;
      }
    });
    // Já dá para encerrar e o que sobra é CUSTO (carta própria: material,
    // descarte): para no mínimo. Seguir marcando enquanto houvesse candidata
    // entregava cartas a mais — "envie até 3" virava sempre 3.
    if(message.can_finish)this.candidates.push(this.candidate(ctx,{type:OcgResponseType.SELECT_UNSELECT_CARD,index:null},0,"heuristic","Encerrar a seleção sem custo adicional"));
    if (message.can_finish && melhorScore < 0) {
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
    }
    return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: melhor };
  }

  /**
   * SELECT_SUM (materiais de Sincro por Nível, tributo de Ritual): entre as
   * combinações que o core aceita (`isValidSum`, a mesma conta da tela),
   * a que custa menos. O respondedor de reserva pegava a primeira válida com
   * menos cartas — às vezes o melhor monstro do campo.
   */
  private selectSum(
    message: OcgMessageSelectSum,
    ctx: BotContext,
  ): OcgResponse | null {
    const request = sumRequestOf(message);
    const n = request.selects.length;
    if (isValidSum(request, [])) return { type: OcgResponseType.SELECT_SUM, indicies: [] };
    // Acima de 16 a busca exaustiva fica cara; o respondedor de reserva cuida.
    if (n === 0 || n > 16) return null;

    const board = ctx.readBoard(false);
    const custo = request.selects.map((card) => {
      if (card.controller === ctx.me && card.location === OcgLocation.MZONE) {
        const noCampo = board.players[ctx.me].monsters[card.sequence];
        if (noCampo) return ownValue(noCampo, ctx.cardDb);
      }
      const intel = readIntel(card.code, ctx.cardDb);
      return Math.max(intel.atk, intel.def);
    });

    let melhor: number[] | null = null;
    let melhorCusto = Infinity;
    for (let mask = 1; mask < 1 << n; mask += 1) {
      if (melhor && (mask & 255) === 0 && performance.now() >= this.deadline) break;
      const escolhidas: number[] = [];
      let total = 0;
      for (let i = 0; i < n; i += 1) {
        if (mask & (1 << i)) {
          escolhidas.push(i);
          total += custo[i];
        }
      }
      if (total > melhorCusto) continue;
      if (total === melhorCusto && melhor && escolhidas.length >= melhor.length) continue;
      if (!isValidSum(request, escolhidas)) continue;
      this.candidates.push(this.candidate(ctx,{type:OcgResponseType.SELECT_SUM,indicies:escolhidas},-total,"heuristic","Combinação válida melhora o custo dos materiais"));
      melhor = escolhidas;
      melhorCusto = total;
    }
    return melhor ? { type: OcgResponseType.SELECT_SUM, indicies: melhor } : null;
  }

  private tribute(
    message: OcgMessageSelectTribute,
    ctx: BotContext,
  ): OcgResponse | null {
    if (message.selects.length === 0) return null;
    const board = ctx.readBoard(false);

    // Tributar é escolher o que perder: vão os de menor valor.
    const notas = message.selects.map((card, index) => {
      const noCampo =
        card.location === OcgLocation.MZONE && card.controller === ctx.me
          ? board.players[ctx.me].monsters[card.sequence]
          : null;
      const intel = readIntel(card.code, ctx.cardDb);
      return {
        index,
        valor: noCampo
          ? ownValue(noCampo, ctx.cardDb)
          : Math.max(intel.atk, intel.def),
        // Quantos tributos esta carta vale — Kaiser Sea Horse e Double Coston
        // valem por dois quando o invocado é do atributo certo.
        peso: Math.max(1, card.release_param),
      };
    });
    notas.sort((a, b) => a.valor - b.valor);

    // `min` é a soma de tributos exigida, não a contagem de cartas: escolher
    // `min` cartas quando uma delas já vale por duas manda o core um índice a
    // mais do que existe, e a resposta volta como RETRY até o duelo travar.
    const escolhidos: number[] = [];
    let somado = 0;
    for (const nota of notas) {
      if (somado >= message.min && escolhidos.length > 0) break;
      escolhidos.push(nota.index);
      somado += nota.peso;
    }

    return { type: OcgResponseType.SELECT_TRIBUTE, indicies: escolhidos };
  }

  private position(
    message: OcgMessageSelectPosition,
    ctx: BotContext,
  ): OcgResponse | null {
    const permitidas = ocgPositionParse(message.positions);
    if (permitidas.length === 0) return null;

    const intel = readIntel(message.code, ctx.cardDb);
    const querAtaque = intel.atk >= 1500 || intel.atk >= intel.def;
    const ordem: Extract<OcgPosition, 1 | 2 | 4 | 8>[] = querAtaque
      ? [
          OcgPosition.FACEUP_ATTACK,
          OcgPosition.FACEUP_DEFENSE,
          OcgPosition.FACEDOWN_DEFENSE,
          OcgPosition.FACEDOWN_ATTACK,
        ]
      : [
          OcgPosition.FACEUP_DEFENSE,
          OcgPosition.FACEDOWN_DEFENSE,
          OcgPosition.FACEUP_ATTACK,
          OcgPosition.FACEDOWN_ATTACK,
        ];

    this.candidates=permitidas.map(position=>this.candidate(ctx,{type:OcgResponseType.SELECT_POSITION,position},ordem.length-ordem.indexOf(position),"heuristic","Posição legal conforme pressão e defesa"));
    const escolhida = ordem.find((pos) => permitidas.includes(pos)) ?? permitidas[0];
    return { type: OcgResponseType.SELECT_POSITION, position: escolhida };
  }

  /** Coloca Links onde suas setas deixam mais zonas próprias utilizáveis. */
  private place(message: OcgMessageSelectPlace, ctx: BotContext): OcgResponse | null {
    const available = decodeFieldMask(message.field_mask, message.player);
    if (available.length < Math.max(1, message.count)) return null;
    const board = ctx.readBoard(false);
    const linked = linkedZones(board);
    const summonCode = ctx.summoning?.player === ctx.me ? ctx.summoning.code : this.plannedSummonCode;
    const intel = summonCode ? readIntel(summonCode, ctx.cardDb) : null;
    const markers = intel?.isLink ? ctx.cardDb.get(summonCode!)?.def ?? 0 : 0;
    const score = (place: typeof available[number]) => {
      if (place.player !== ctx.me) return -100;
      if (place.location === OcgLocation.SZONE) {
        // As bordas 0 e 4 são as escalas Pêndulo na MR5.
        return place.sequence === 5 ? 4 : [0, 4].includes(place.sequence) ? 2 : 8;
      }
      if (place.location !== OcgLocation.MZONE) return 0;
      if (markers) {
        const arrows = pointedZones({ controller: ctx.me, sequence: place.sequence }, markers);
        const ownFree = arrows.filter((zone) => zone.controller === ctx.me && zone.sequence < 5
          && !board.players[ctx.me].monsters[zone.sequence]).length;
        const enemyFree = arrows.filter((zone) => zone.controller !== ctx.me && zone.sequence < 5
          && !board.players[1 - ctx.me].monsters[zone.sequence]).length;
        return ownFree * 20 - enemyFree * 15 + (place.sequence >= 5 ? 5 : 0);
      }
      const reservedForLink = linked.has(`${ctx.me}:${OcgLocation.MZONE}:${place.sequence}`);
      return (place.sequence >= 5 ? -8 : 10) - (reservedForLink ? 6 : 0);
    };
    available.sort((a, b) => score(b) - score(a));
    this.candidates=available.map(place=>{
      const places=[place,...available.filter(other=>other!==place)].slice(0,Math.max(1,message.count));
      return this.candidate(ctx,{type:OcgResponseType.SELECT_PLACE,places},places.reduce((sum,p)=>sum+score(p),0),"heuristic","Zonas livres e setas Link próprias e adversárias");
    });
    const selected = available.slice(0, Math.max(1, message.count));
    this.plannedSummonCode = null;
    return { type: OcgResponseType.SELECT_PLACE, places: selected };
  }

  /**
   * Efetiva um plano, contabilizando a ativação que ele carrega.
   *
   * A contagem é feita **na escolha**, e não quando o core confirma a ativação:
   * a carta muda de zona ao ser ativada (uma magia sai da mão para a zona de
   * magias), então a chave que voltaria pelo CHAINING não é a mesma que veio em
   * `activates` — e a trava anti-loop, que compara chaves, deixaria de travar
   * exatamente o caso para o qual existe: a carta contínua que já está no campo
   * e volta a ser oferecida depois de resolver.
   */
  private commit(plan: Plan): OcgResponse {
    if (plan.lessonId) { this.guideLesson = plan.lessonId; this.decisionSource = "guide"; }
    if (plan.activated) this.noteActivation(plan.activated);
    if (plan.setsBackrow) this.setsNoTurno += 1;
    if (plan.decision) {
      this.pendingDecisionTarget = plan.decision.targetCode ?? null;
      this.usedGuideDecision = plan.decision.decision.id;
      this.planner.reason = `Cenário do guia: ${plan.decision.decision.title}`;
    } else if (plan.continuation) {
      this.usedGuideDecision = plan.continuation.id;
      this.planner.reason = `Sequência prevista pelo guia: ${plan.continuation.title}`;
    } else if (plan.hold) {
      this.usedGuideDecision = plan.hold.id;
      this.planner.reason = `Guardar recurso: ${plan.hold.title}`;
    }
    return plan.response;
  }

  private noteActivation(card: OcgCardLoc): void {
    this.plannedTarget = null;
    const key = chave(card, this.tacticalModel);
    this.activations.set(key, (this.activations.get(key) ?? 0) + 1);
    this.planner.intents.begin(card.code, this.planner.route, this.planner.step,
      "description" in card ? card.description as bigint : undefined);
  }
}
