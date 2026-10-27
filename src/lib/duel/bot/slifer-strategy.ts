import { OcgLocation as L, OcgMessageType as M, OcgResponseType as R, OcgPhase, OcgType, SelectIdleCMDAction as A,
  SelectBattleCMDAction as B, type OcgCardLoc, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import type { BoardCard, BoardPlayer } from "@/lib/duel/board-state";
import type { BotContext } from "@/lib/duel/bot/bot-brain";
import type { DuelDeckPayload } from "@/lib/types";
import { readIntel } from "@/lib/duel/bot/card-intel";
import { ownValue, threatOf } from "@/lib/duel/bot/combat";

const C = {
  slifer: 10000020, ahrima: 86377375, lair: 59160188, cross: 5253985, thunder: 42469671,
  reactor: 79387392, advance: 52112003, name: 39913299, sky: 12958919, pass: 93104632,
  duke: 12766474, vishuda: 23431858, controller: 98045062, march: 19870120, guard: 4694209,
  ultimate: 32247099, front: 59919307, reborn: 83764718, ghost: 67284107, tellus: 19280589,
  fox: 27198001, supply: 17626381, greed: 37576645, fate: 856784, avarice: 67169062,
  breaker: 71413901, darkBreaker: 22923081,
  book: 14087893, swords: 72302403, harpies: 18144506,
} as const;
const LESSON = {
  access: "ahrima-encontra-o-covil", tribute: "ahrima-tributa-o-adversario",
  controller: "covil-e-controlador-de-inimigos", reactor: "slime-reator-e-avanco-de-carta",
  sky: "skyblaster-ajuda-a-reunir-os-tributos", cross: "cruzar-almas-nao-e-covil",
  name: "avanco-e-o-nome-verdadeiro", hand: "slifer-controla-a-mesa-e-a-mao",
  thunder: "thunderforce-protege-e-recompoe-a-mao", protect: "proteger-slifer-e-o-covil",
  revive: "recuperar-slifer-na-janela-certa", resources: "fichas-e-recursos-sem-slifer",
  duke: "duke-vishuda-e-os-bloqueios",
} as const;
type Effect = OcgCardLoc & { description?: bigint };
export interface SliferRating { score: number; lessonId: string; reason: string }
interface SliferAnswer extends Omit<SliferRating, "score"> { response: OcgResponse }
const bodies = (p: BoardPlayer): BoardCard[] => p.monsters.filter((c): c is BoardCard => Boolean(c));
const holds = (p: BoardPlayer, code: number) => p.hand.some(c => c.code === code);
const faceup = (p: BoardPlayer, code: number) => bodies(p).some(c => c.code === code && !c.faceDown && !c.negated);
const desc = (code: number, index: number) => (BigInt(code) << 20n) + BigInt(index);
const indexOf = (e: { code: number; description?: bigint }) => e.description !== undefined && e.description >= 0x100000n
  ? Number(e.description - (BigInt(e.code) << 20n)) : 0;
const oneOf = (code: number | undefined, ...codes: number[]) => code !== undefined && codes.includes(code);
const rating = (score: number, lessonId: string, reason: string): SliferRating => ({ score, lessonId, reason: `Guia Slifer: ${reason}` });

/** Política da lista revisada. Só é instanciada pelo vínculo de assinatura do guia. */
export class SliferStrategy {
  private turn = -1;
  private lairSpent = false;
  private active: Effect | null = null;
  private controllerMode = 0;
  private costFinished = false;
  private knownTop: { code: number; revision: number; size: number } | null = null;
  private tributeSlifer = false;
  private pendingSlifer: "tribute" | "special" | null = null;
  private sawSlifer = false;
  private thunderDraw = true;

  private readonly deck: DuelDeckPayload;
  constructor(deck: DuelDeckPayload) { this.deck = deck; }

  prepare(ctx: BotContext): void {
    if (ctx.turnCount !== this.turn) { this.turn = ctx.turnCount; this.lairSpent = false; this.active = null; }
    const mine = ctx.readBoard(true).players[ctx.me];
    if (this.knownTop && (this.knownTop.revision !== (ctx.deckRevision ?? 0) || this.knownTop.size !== mine.deckSize)) this.knownTop = null;
    const has = faceup(mine, C.slifer);
    if (has && this.pendingSlifer) { this.tributeSlifer = this.pendingSlifer === "tribute"; this.pendingSlifer = null; }
    if (!has && this.sawSlifer) this.tributeSlifer = false;
    this.sawSlifer = has;
    if (ctx.prompt.type === M.SELECT_IDLECMD) {
      this.active = null;
      if (!has) this.pendingSlifer = null;
    }
  }

  private remaining(code: number, mine: BoardPlayer): number {
    const visible = [...mine.hand, ...mine.monsters, ...mine.spells, mine.field, ...mine.grave, ...mine.banished];
    return Math.max(0, this.deck.main.filter(c => c === code).length - visible.filter(c => c?.code === code).length);
  }
  private used(code: number, ctx: BotContext): boolean {
    return Boolean(ctx.turnResources?.effectsUsed.some(key => key.startsWith(`${ctx.me}:${code}:`)));
  }
  private lair(mine: BoardPlayer): boolean {
    return Boolean(mine.field?.code === C.lair && !mine.field.negated && !mine.field.faceDown && !this.lairSpent);
  }
  private window(ctx: BotContext, mine: BoardPlayer): boolean {
    return !ctx.turnResources?.normalUsed || this.used(C.advance, ctx) || holds(mine, C.cross);
  }
  private reactorLine(mine: BoardPlayer, ctx: BotContext): boolean {
    return holds(mine, C.slifer) && (holds(mine, C.advance) || this.used(C.advance, ctx) || holds(mine, C.cross))
      && (holds(mine, C.reactor) || faceup(mine, C.reactor));
  }
  private cheap(card: BoardCard, ctx: BotContext): number {
    if (card.code === C.slifer) return 20_000;
    if (card.code === C.tellus) return 50;
    const token = card.code !== null && Boolean((ctx.cardDb.get(card.code)?.type ?? 0) & OcgType.TOKEN);
    return token ? Math.max(200, ownValue(card, ctx.cardDb)) : Math.max(500, ownValue(card, ctx.cardDb)) + (card.code === C.ahrima ? 900 : 0);
  }
  private fodder(mine: BoardPlayer, ctx: BotContext, darkOnly = false): boolean {
    if (holds(mine, C.slifer) && bodies(mine).length <= 3 && this.window(ctx, mine)) return false;
    return bodies(mine).some(c => this.cheap(c, ctx) <= 600 && (!darkOnly || c.attribute === "DARK"));
  }
  private enemies(foe: BoardPlayer): BoardCard[] { return bodies(foe).filter(c => !c.faceDown); }
  private pressure(foe: BoardPlayer): number { return this.enemies(foe).reduce((n, c) => n + (c.defense ? 0 : c.attack ?? 0), 0); }
  private search(mine: BoardPlayer, foe: BoardPlayer, ctx: BotContext): number | null {
    if (faceup(mine, C.slifer) && (mine.hand.length + 1) * 1000 >= ctx.lifePoints[1 - ctx.me]) return null;
    if (mine.grave.some(c => c.code === C.vishuda || c.code === C.darkBreaker) && this.remaining(C.duke, mine)) return C.duke;
    if (this.remaining(C.vishuda, mine) && bodies(mine).some(c => c.code !== null
      && !(readIntel(c.code, ctx.cardDb).isEffect)) && bodies(foe).length) return C.vishuda;
    return null;
  }

  /** Pontua somente ações presentes no prompt, com os pré-requisitos da lição. */
  idle(action: number, card: Effect, ctx: BotContext): SliferRating | null {
    const { players } = ctx.readBoard(true), mine = players[ctx.me], foe = players[1 - ctx.me];
    const count = bodies(mine).length, hasGod = faceup(mine, C.slifer);
    const normal = action === A.SELECT_SUMMON, activate = action === A.SELECT_ACTIVATE;
    const canTribute = this.window(ctx, mine), handGod = holds(mine, C.slifer);
    if (normal && card.code === C.slifer) return rating(mine.hand.length >= 2 ? 175 : -1, LESSON.hand, "Invocação-Tributo preservando cartas para o ATK");
    if (normal && card.code === C.reactor && this.reactorLine(mine, ctx)) return rating(170, LESSON.reactor, "Normal no Reator com janela adicional preparada");
    if (normal && card.code === C.sky && handGod && canTribute && count >= 1) return rating(165, LESSON.sky, "multiplicar o corpo prévio antes da Invocação-Tributo");
    if (normal && card.code === C.ahrima && (this.lair(mine) || holds(mine, C.lair)) && this.enemies(foe).length)
      return rating(160, LESSON.tribute, "Ahrima no campo habilita remoção com o Covil");
    if (action === A.SELECT_MONSTER_SET && card.code === C.ghost && !hasGod) return rating(95, LESSON.resources, "preparar Fichas sem desperdiçar uma rota pronta");
    if (action === A.SELECT_SPELL_SET && hasGod && (mine.hand.length <= 2 || mine.hand.length <= 3 && mine.spells.some(Boolean)))
      return rating(-1, LESSON.hand, "conservar a mão e o ATK quando já há defesa preparada");
    if (hasGod && mine.hand.length <= 3 && (action === A.SELECT_MONSTER_SET
      || action === A.SELECT_SPECIAL_SUMMON && card.location === L.HAND))
      return rating(-1, LESSON.hand, "preservar o ATK do Deus em vez de gastar a mão em mais um corpo");
    if (normal && hasGod && card.code !== C.guard && mine.hand.length <= 3)
      return rating(-1, LESSON.hand, "evitar desenvolvimento que enfraquece o Deus sem necessidade");
    if (!activate) return null;
    const effect = this.effect(card, ctx);
    if (effect) return effect;
    return null;
  }

  effect(card: Effect, ctx: BotContext): SliferRating | null {
    const { players } = ctx.readBoard(true), mine = players[ctx.me], foe = players[1 - ctx.me];
    const count = bodies(mine).length, enemies = this.enemies(foe), i = indexOf(card);
    const handGod = holds(mine, C.slifer), god = faceup(mine, C.slifer), own = ctx.turnPlayer === ctx.me;
    const main1 = own && ctx.phase === OcgPhase.MAIN1;
    const ownMain = own && (ctx.phase === OcgPhase.MAIN1 || ctx.phase === OcgPhase.MAIN2);
    const canTribute = this.window(ctx, mine), freeEnemy = this.lair(mine) && enemies.some(c => c.attribute === "DARK");
    switch (card.code) {
      case C.ahrima:
        if (card.location === L.HAND) return rating(mine.field?.code !== C.lair && !holds(mine, C.lair) && this.remaining(C.lair, mine) > 0 ? 155 : -1,
          LESSON.access, "buscar o Campo sem gastar a Normal; preservar cópias quando já existe acesso");
        if (card.location === L.MZONE) return rating(freeEnemy ? 185 : this.fodder(mine, ctx, true) ? 135 : -1,
          LESSON.tribute, "tributar adversário ou recurso substituível, preservando Ahrima e os três corpos do Deus");
        return null;
      case C.lair: return rating(mine.field?.code === C.lair && !mine.field.faceDown || god && !holds(mine, C.ahrima) && !faceup(mine, C.ahrima) ? -1 : 180,
        LESSON.tribute, "estabelecer o Campo antes de pagar o custo adversário");
      case C.advance: {
        const normalGod = ctx.prompt.type === M.SELECT_IDLECMD && ctx.prompt.summons.some(c => c.code === C.slifer);
        const needed = holds(mine, C.name) && this.remaining(C.slifer, mine) > 0 && !this.knownTop
          || handGod && !normalGod && !this.used(C.advance, ctx) && (count >= 3 || this.reactorLine(mine, ctx) || holds(mine, C.sky) && (count > 0 || holds(mine, C.pass)));
        return rating(needed ? 195 : -1, holds(mine, C.name) ? LESSON.name : LESSON.reactor, "preparar topo conhecido ou a Invocação-Tributo adicional necessária");
      }
      case C.name: return rating(this.knownTop && this.remaining(C.slifer, mine) > 0 ? 210 : -1, LESSON.name, "declarar somente o topo realmente conhecido após Avanço");
      case C.reactor:
        if (i === 0) return rating(handGod && canTribute && count <= 3 ? 175 : -1, LESSON.reactor, "criar dois Tributos só com uma continuação de Besta Divina");
        return rating(!handGod && this.pressure(foe) >= ctx.lifePoints[ctx.me] ? 90 : -1, LESSON.resources, "trocar Reator por defesa apenas quando há necessidade");
      case C.pass: return rating(handGod && canTribute && (count === 2 || count === 0 && holds(mine, C.sky)) ? 180 : !god && count === 0 ? 65 : -1,
        LESSON.sky, "criar o corpo anterior ao Skyblaster ou completar os três Tributos");
      case C.cross: {
        const normalGod = ctx.prompt.type === M.SELECT_IDLECMD && ctx.prompt.summons.some(c => c.code === C.slifer);
        return rating(!handGod || own && normalGod || mine.hand.length - 1 - Number(card.location === L.HAND) < 1 ? -1 : 170, LESSON.cross, "usar a janela da Magia e conservar a ativação limitada após Tributos adversários");
      }
      case C.controller:
        return rating(own && !ownMain ? -1 : freeEnemy && enemies.length >= 2 ? 150 : this.fodder(mine, ctx) && enemies.length && (main1 || !own) ? 110 : -1,
          LESSON.controller, "pagar um recurso justificável para tomar outro monstro; evitar simples troca de posição sem ganho");
      case C.duke:
        if (card.location !== L.HAND) return rating(100, LESSON.duke, "recuperar um TREVAS elegível do Cemitério");
        return rating(this.reactorLine(mine, ctx) || holds(mine, C.name) && this.remaining(C.slifer, mine) > 0 ? -1
          : freeEnemy || this.fodder(mine, ctx, true) && mine.grave.some(c => c.code === C.vishuda || c.code === C.darkBreaker) ? 140 : -1,
        LESSON.duke, "remover ou recuperar sem bloquear a rota prioritária de Slifer");
      case C.march: return rating(god ? this.tributeSlifer && mine.hand.length >= 2 + Number(card.location === L.HAND) ? 185 : -1
        : handGod && mine.hand.length >= 3 + Number(card.location === L.HAND) + Number(holds(mine, C.reactor)) && (count >= 3 || this.reactorLine(mine, ctx)) ? 185 : -1,
        LESSON.protect, "proteger a Invocação-Tributo; não gastar proteção inútil num Slifer Especial");
      case C.guard: return rating(mine.field?.code === C.lair || god && this.tributeSlifer ? 95 : -1,
        LESSON.protect, "transferir o Marcador para proteger o motor em vez de tratar alvo próprio como custo");
      case C.thunder: {
        const draw = enemies.filter(c => c.code === null || !((ctx.cardDb.get(c.code)?.type ?? 0) & OcgType.TOKEN)).length;
        const projected = (mine.hand.length - Number(card.location === L.HAND) + draw) * 1000;
        return rating(!enemies.length || own && !ownMain ? -1 : own ? projected >= ctx.lifePoints[1 - ctx.me] ? 220 : 180
          : enemies.length >= 2 || this.pressure(foe) >= ctx.lifePoints[ctx.me] ? 140 : -1,
        LESSON.thunder, "limpar face-up e calcular a mão depois do gasto da Magia e da compra");
      }
      case C.reborn:
      case C.front: {
        if (god && mine.hand.length <= 3 && card.location === L.HAND) return rating(-1, LESSON.hand, "preservar o ATK do Slifer em vez de reanimar um corpo sem urgência");
        const other = mine.grave.some(c => c.code !== null && c.code !== C.slifer && readIntel(c.code, ctx.cardDb).isMonster);
        const usefulGod = mine.grave.some(c => c.code === C.slifer) && (main1 && ctx.turnCount > 1 && mine.hand.length >= 3
          || own && holds(mine, C.thunder) && enemies.length >= 2 || !own && ctx.phase !== OcgPhase.END && mine.hand.length >= 2);
        return rating(usefulGod ? 145 : other ? 105 : -1, LESSON.revive, "reanimar por ataque, controle ou continuação concreta; evitar Slifer sem função na Main 2");
      }
      case C.ultimate: return rating(mine.grave.some(c => c.code === C.slifer) && mine.hand.some(c => c.code !== null && !readIntel(c.code, ctx.cardDb).isMonster)
        || god && ctx.phase === OcgPhase.END ? 120 : -1, LESSON.revive, "ativar defesa ou limpeza somente com recurso elegível");
      case C.sky: return rating(i === 0 ? 100 : -1, LESSON.sky, "gerar corpos; preservar o ataque em vez do dano pequeno de Apoio");
      case C.ghost: return rating(100, LESSON.resources, "aceitar Fichas gratuitas para defesa ou Tributo");
      case C.tellus: return rating(i === 0 ? 100 : handGod && canTribute && count < 3 && mine.hand.some(c => c.code !== null
        && readIntel(c.code, ctx.cardDb).isSpell && c.code !== C.advance && c.code !== C.cross) ? 120 : -1,
        LESSON.resources, "repor corpos sem banir a única janela que permitiria usar os Tributos");
      case C.fox: return rating(i === 1 ? 100 : freeEnemy && this.fodder(mine, ctx) ? 115 : -1,
        LESSON.resources, "distinguir Fichas por destruição da troca de dois corpos por Raposa");
      case C.breaker:
      case C.darkBreaker: return rating(foe.spells.some(Boolean) || foe.field ? 115 : -1, LESSON.resources, "gastar Marcadores para remover cartas adversárias, nunca o próprio Covil sem retorno");
      case C.greed: return rating(god && (mine.hand.length + 2 - Number(card.location === L.HAND)) * 1000 >= ctx.lifePoints[1 - ctx.me] ? 160 : !own && this.pressure(foe) >= ctx.lifePoints[ctx.me] ? 100 : -1,
        LESSON.hand, "aceitar a dívida de duas compras apenas por retorno imediato");
      case C.fate: return rating(this.pressure(foe) >= ctx.lifePoints[ctx.me] ? 90 : -1, LESSON.resources, "guardar compra restritiva para uma saída necessária");
      case C.avarice: return rating(holds(mine, C.name) && this.knownTop ? -1 : 145, LESSON.hand, "reciclar e comprar sem embaralhar o topo de uma linha já preparada");
      case C.book: {
        const attackers = bodies(mine).filter(c => !c.faceDown && !c.defense);
        const before = Math.max(0, ...attackers.map(c => c.attack ?? 0));
        const after = Math.max(0, ...attackers.map(c => (c.attack ?? 0) - Number(c.code === C.slifer && card.location === L.HAND) * 1000));
        const battle = ctx.phase !== null && Boolean(ctx.phase & (OcgPhase.BATTLE_START | OcgPhase.BATTLE_STEP | OcgPhase.BATTLE));
        return rating(main1 && enemies.some(c => !c.defense && (c.attack ?? 0) >= before && (c.defenseValue ?? Infinity) < after)
          || !own && battle && enemies.length ? 110 : -1, LESSON.hand, "virar uma ameaça por benefício concreto; nunca esconder o próprio Slifer sem ganho");
      }
      case C.swords: return rating(this.pressure(foe) > bodies(mine).reduce((n, c) => n + (c.attack ?? 0), 0) ? 110 : -1,
        LESSON.resources, "ganhar tempo apenas quando o campo adversário exige defesa");
      case C.harpies: return rating(foe.spells.some(Boolean) || foe.field ? 200 : -1,
        LESSON.cross, "limpar respostas adversárias antes de comprometer a Invocação-Tributo");
      case C.supply: return rating(god && mine.hand.length <= 3 ? -1 : count > 0 && bodies(foe).length > 0 ? 80 : -1,
        LESSON.resources, "preparar reposição por destruição sem enfraquecer Slifer por uma compra que não virá dos Tributos");
      default: return null;
    }
  }

  /** Prompts de custos, alvos e opções seguem o efeito real, inclusive durante a resolução. */
  respond(ctx: BotContext): SliferAnswer | null {
    const p = ctx.prompt, board = ctx.readBoard(true), mine = board.players[ctx.me], foe = board.players[1 - ctx.me];
    const effect = ctx.resolvingEffect?.player === ctx.me ? ctx.resolvingEffect : ctx.resolvingEffect ? null : this.active;
    const code = effect?.code;
    const answer = (response: OcgResponse, lessonId: string, reason: string): SliferAnswer => ({ response, lessonId, reason: `Guia Slifer: ${reason}` });
    if (p.type === M.SELECT_EFFECTYN && p.controller === ctx.me) {
      const value = this.effect(p, ctx);
      if (value) return answer({ type: R.SELECT_EFFECTYN, yes: value.score > 0 }, value.lessonId, value.reason);
    }
    if (p.type === M.SORT_CARD && code === C.advance && p.cards.length) {
      const top = p.cards.findIndex(c => c.code !== C.slifer);
      const order = [Math.max(0, top), ...p.cards.map((_, i) => i).filter(i => i !== Math.max(0, top))];
      return answer({ type: R.SORT_CARD, order: p.cards.map((_, i) => order.indexOf(i)) }, LESSON.name, "ordenar o topo conhecido sem gastar o alvo DIVINO na primeira carta");
    }
    if (p.type === M.ANNOUNCE_CARD && code === C.name && this.knownTop)
      return answer({ type: R.ANNOUNCE_CARD, card: this.knownTop.code }, LESSON.name, "declarar a carta vista; nunca consultar a ordem oculta do Deck");
    if (p.type === M.SELECT_YESNO) {
      if (p.description === desc(C.ahrima, 2)) return answer({ type: R.SELECT_YESNO, yes: this.search(mine, foe, ctx) !== null }, LESSON.tribute, "escolher busca contextual ou compra, em vez de buscar sempre");
      if (p.description === desc(C.thunder, 0)) return answer({ type: R.SELECT_YESNO, yes: this.thunderDraw }, LESSON.thunder, "comparar a compra com a necessidade de múltiplos ataques");
      if (code === C.name) return answer({ type: R.SELECT_YESNO, yes: true }, LESSON.name, "acessar o DIVINO depois de acertar o topo");
    }
    if (p.type === M.SELECT_OPTION && code === C.controller) {
      const wanted = desc(C.controller, 2);
      const index = p.options.indexOf(wanted);
      return answer({ type: R.SELECT_OPTION, index: index >= 0 ? index : 0 }, LESSON.controller, "selecionar tomada de controle somente entre modos oferecidos");
    }
    if (p.type === M.SELECT_OPTION && code === C.name) {
      const toHand = p.options.indexOf(573n);
      const special = p.options.indexOf(desc(C.name, 3));
      const summonNow = ctx.turnPlayer === ctx.me && ctx.phase === OcgPhase.MAIN1 && ctx.turnCount > 1
        && !holds(mine, C.slifer) && (mine.hand.length >= 3 || holds(mine, C.thunder))
        && !(bodies(mine).length >= 3 && this.window(ctx, mine));
      return answer({ type: R.SELECT_OPTION, index: summonNow && special >= 0 ? special : toHand >= 0 ? toHand : 0 }, LESSON.name,
        "escolher mão para a Invocação-Tributo ou Especial por ganho imediato");
    }
    const selecting = p.type === M.SELECT_CARD || p.type === M.SELECT_UNSELECT_CARD || p.type === M.SELECT_TRIBUTE;
    if (!selecting) return null;
    const cards = p.type === M.SELECT_UNSELECT_CARD ? p.select_cards : p.selects;
    if (!cards.length) return null;
    const modeled = oneOf(code, C.ahrima, C.controller, C.cross, C.duke, C.name, C.guard, C.reborn, C.front, C.ultimate, C.tellus, C.fox, C.vishuda, C.fate)
      || p.type === M.SELECT_TRIBUTE && this.pendingSlifer === "tribute";
    if (!modeled) return null;
    if (p.type === M.SELECT_UNSELECT_CARD && p.can_finish)
      return answer({ type: R.SELECT_UNSELECT_CARD, index: null }, code === C.cross ? LESSON.cross : LESSON.tribute, "terminar no mínimo legal, sem tributar recursos extras");
    const value = (c: OcgCardLoc): number => {
      if (c.controller !== ctx.me) {
        const target = board.players[c.controller].monsters[c.sequence];
        return 10_000 + (target ? threatOf(target, ctx.cardDb) : 1500);
      }
      if (c.location === L.DECK) {
        if (code === C.ahrima) return c.code === C.lair || c.code === this.search(mine, foe, ctx) ? 20_000 : 0;
        if (code === C.name) return c.code === C.slifer ? 20_000 : 0;
      }
      if (c.location === L.HAND) {
        if (code === C.cross) return c.code === C.slifer ? 20_000 : -20_000;
        const essential = oneOf(c.code, C.slifer, C.advance, C.cross, C.name);
        return essential ? -10_000 : c.code === C.greed || c.code === C.fate ? -100 : -1000;
      }
      if (c.location === L.GRAVE) {
        if (code === C.duke) return c.code === C.vishuda ? 15_000 : 10_000;
        if (code === C.reborn || code === C.front || code === C.ultimate) return c.code === C.slifer ? 15_000
          : holds(mine, C.slifer) && c.code === C.reactor ? 18_000 : c.code === C.ahrima && this.lair(mine) ? 16_000 : 1000;
      }
      const own = bodies(mine).find(b => b.sequence === c.sequence && b.location === c.location);
      if (code === C.guard) return c.code === C.slifer && this.tributeSlifer ? 15_000 : c.code === C.lair ? 12_000 : 500;
      return own ? -this.cheap(own, ctx) : -1400;
    };
    const ranked = cards.map((c, index) => ({ c, index, value: value(c) })).sort((a, b) => b.value - a.value);
    const lessonId = code === C.controller ? LESSON.controller : code === C.cross ? LESSON.cross : p.type === M.SELECT_TRIBUTE && this.pendingSlifer === "tribute" ? LESSON.hand : code === C.name ? LESSON.name
      : code === C.duke ? LESSON.duke : code === C.guard ? LESSON.protect : code === C.reborn || code === C.front || code === C.ultimate ? LESSON.revive : LESSON.tribute;
    if (p.type === M.SELECT_UNSELECT_CARD) return answer({ type: R.SELECT_UNSELECT_CARD, index: ranked[0].index }, lessonId, "selecionar ameaça adversária antes de sacrificar a própria mesa");
    if (p.type === M.SELECT_CARD && p.min === 0 && (p.max === 0 || ranked[0].value <= 0))
      return answer({ type: R.SELECT_CARD, indicies: [] }, lessonId, "preservar recurso quando a seleção é opcional e não há benefício");
    let count = p.min;
    if (p.type === M.SELECT_TRIBUTE) {
      let total = 0; count = 0;
      for (const item of ranked) { total += Math.max(1, (item.c as { release_param?: number }).release_param ?? 1); count++; if (total >= p.min) break; }
    }
    return answer({ type: p.type === M.SELECT_CARD ? R.SELECT_CARD : R.SELECT_TRIBUTE, indicies: ranked.slice(0, Math.max(count, 1)).map(c => c.index) }, lessonId,
      "pagar apenas o custo necessário e preservar acesso, Slifer e o Campo");
  }

  /** Registra somente a resposta final aceita pelo contrato do prompt. */
  record(ctx: BotContext, response: OcgResponse): void {
    const p = ctx.prompt;
    let chosen: Effect | undefined;
    if (p.type === M.SELECT_IDLECMD && response.type === R.SELECT_IDLECMD && response.index !== null) {
      if (response.action === A.SELECT_ACTIVATE) chosen = p.activates[response.index];
      if (response.action === A.SELECT_SUMMON && p.summons[response.index]?.code === C.slifer) this.pendingSlifer = "tribute";
    }
    if (p.type === M.SELECT_BATTLECMD && response.type === R.SELECT_BATTLECMD && response.action === B.SELECT_CHAIN && response.index !== null) chosen = p.chains[response.index];
    if (p.type === M.SELECT_CHAIN && response.type === R.SELECT_CHAIN && response.index !== null) chosen = p.selects[response.index];
    if (p.type === M.SELECT_EFFECTYN && response.type === R.SELECT_EFFECTYN && response.yes) chosen = p;
    if (chosen) {
      this.active = chosen; this.costFinished = false;
      if (chosen.code === C.controller) this.controllerMode = 0;
      if (chosen.code === C.thunder) {
        const mine = ctx.readBoard(true).players[ctx.me], foe = ctx.readBoard(true).players[1 - ctx.me];
        const attackers = bodies(mine).filter(c => !c.faceDown && !c.defense);
        const draw = this.enemies(foe).filter(c => c.code === null || !((ctx.cardDb.get(c.code)?.type ?? 0) & OcgType.TOKEN)).length;
        const cost = Number(chosen.location === L.HAND);
        const boosted = Math.max((mine.hand.length - cost + draw) * 1000, ...attackers.filter(c => c.code !== C.slifer).map(c => c.attack ?? 0));
        const sum = attackers.reduce((n, c) => n + (c.code === C.slifer ? (mine.hand.length - cost) * 1000 : c.attack ?? 0), 0);
        this.thunderDraw = attackers.length <= 1 || sum < ctx.lifePoints[1 - ctx.me] || boosted >= ctx.lifePoints[1 - ctx.me];
      }
    }
    if (p.type === M.SORT_CARD && response.type === R.SORT_CARD
      && (ctx.resolvingEffect?.player === ctx.me ? ctx.resolvingEffect.code : this.active?.code) === C.advance
      && (response.order || p.cards.length === 1)) {
      const top = response.order?.indexOf(0) ?? 0;
      if (p.cards[top]) this.knownTop = { code: p.cards[top].code, revision: ctx.deckRevision ?? 0, size: ctx.readBoard(true).players[ctx.me].deckSize };
    }
    if (p.type === M.SELECT_OPTION && response.type === R.SELECT_OPTION) {
      if (this.active?.code === C.controller) this.controllerMode = p.options[response.index] === desc(C.controller, 2) ? 2 : 1;
      if (this.active?.code === C.name) this.pendingSlifer = p.options[response.index] === 573n ? null : "special";
    }
    const cards = p.type === M.SELECT_UNSELECT_CARD && response.type === R.SELECT_UNSELECT_CARD && response.index !== null ? [p.select_cards[response.index]]
      : p.type === M.SELECT_CARD && response.type === R.SELECT_CARD ? (response.indicies ?? []).map(i => p.selects[i]) : [];
    if (this.active?.code === C.cross && cards.some(c => c?.code === C.slifer && c.location === L.HAND)) this.pendingSlifer = "tribute";
    const resolving = ctx.resolvingEffect?.player === ctx.me ? ctx.resolvingEffect.code : this.active?.code;
    if (oneOf(resolving, C.reborn, C.front, C.ultimate)
      && cards.some(c => c?.code === C.slifer && c.controller === ctx.me && c.location === L.GRAVE)) this.pendingSlifer = "special";
    const release = oneOf(this.active?.code, C.ahrima, C.duke, C.fox)
      || this.active?.code === C.controller && this.controllerMode === 2 && !this.costFinished;
    if (release && cards.some(c => c && c.controller !== ctx.me)) this.lairSpent = true;
    if (release && cards.length) this.costFinished = true;
  }
}
