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
  type OcgMessageSelectSum,
  type OcgMessageSelectTribute,
  type OcgMessageSelectUnselectCard,
  type OcgResponse,
} from "@n1xx1/ocgcore-wasm";

import { isDeclarable } from "@/lib/duel/announce-filter";
import type { BoardCard, BoardPlayer, BoardState } from "@/lib/duel/board-state";
import { botAutoResponse } from "@/lib/duel/bot-responder";
import { readIntel, roleOf, type CardIntel } from "@/lib/duel/bot/card-intel";
import {
  appraiseAttack,
  knownStats,
  ownValue,
  threatOf,
} from "@/lib/duel/bot/combat";
import type { OfficialCardDb } from "@/lib/duel/official-card-data";
import { isValidSum, sumRequestOf } from "@/lib/duel/sum-selection";

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
}

function chave(card: OcgCardLoc): string {
  return `${card.code}:${card.controller}:${card.location}:${card.sequence}`;
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
  private plannedTarget: { controller: number; sequence: number } | null = null;

  /**
   * Decide a resposta a um prompt.
   *
   * Qualquer erro cai no `botAutoResponse`, o respondedor antigo: ele não joga
   * bem, mas responde *tudo* de um jeito que o core aceita. É essa rede que
   * garante que uma heurística nova com defeito estrague uma jogada em vez de
   * travar o duelo inteiro.
   */
  decide(ctx: BotContext): OcgResponse {
    if (ctx.turnCount !== this.turn) {
      this.turn = ctx.turnCount;
      this.idleSteps = 0;
      this.battleSteps = 0;
      this.chainSteps = 0;
      this.setsNoTurno = 0;
      this.activations.clear();
    }

    try {
      const chosen = this.think(ctx);
      if (chosen) return chosen;
    } catch {
      // Cai no respondedor à prova de travamento, abaixo.
    }
    return botAutoResponse(ctx.prompt);
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
      case OcgMessageType.SELECT_CARD:
        return this.selectCard(prompt, ctx);
      case OcgMessageType.SELECT_UNSELECT_CARD:
        return this.selectUnselect(prompt, ctx);
      case OcgMessageType.SELECT_TRIBUTE:
        return this.tribute(prompt, ctx);
      case OcgMessageType.SELECT_POSITION:
        return this.position(prompt, ctx);
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
    const plans: Plan[] = [];

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

    // Sem nada melhor a fazer e sem End Phase oferecida (Main 2 depois de uma
    // batalha), o core ainda espera resposta — o fallback é quem sabe montá-la.
    if (plans.length === 0) return botAutoResponse(message);

    return this.commit(plans.sort((a, b) => b.score - a.score)[0]);
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
    return 104 + Math.min(intel.atk, 3000) / 300;
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
    const materiais = intel.isLink ? Math.max(1, intel.linkRating) : 2;
    const valores = ocupadas(mine.monsters)
      .map((c) => ownValue(c, ctx.cardDb))
      .sort((a, b) => a - b);
    let custo = 0;
    for (let i = 0; i < materiais; i += 1) custo += valores[i] ?? OFF_FIELD_MATERIAL;
    if (intel.isXyz) custo *= 0.75;

    // Efeito vale mais que os números — é quase sempre o motivo de existir
    // do monstro do Extra Deck.
    const valor = intel.atk + (intel.isEffect ? 600 : 0);
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
    const usos = this.activations.get(chave(card)) ?? 0;
    if (usos >= SAME_CARD_ACTIVATIONS) return -1;

    const intel = readIntel(card.code, ctx.cardDb);
    // Pêndulo da mão "ativado" é a carta indo para a escala, não um efeito.
    if (card.location === OcgLocation.HAND && intel.isPendulum && intel.isMonster) {
      return this.scorePendulumScale(card, intel, ctx, mine);
    }
    const role = roleOf(card.code);
    const meusMonstros = ocupadas(mine.monsters);
    const monstrosDele = ocupadas(foe.monsters);
    const backrowDele = ocupadas(foe.spells).length;

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
        // Leva os monstros dos DOIS lados: só compensa quando o campo dele vale
        // mais que o meu. É a diferença entre limpar a mesa e se auto-destruir.
        const meu = meusMonstros.reduce((t, c) => t + ownValue(c, ctx.cardDb), 0);
        const dele = monstrosDele.reduce((t, c) => t + threatOf(c, ctx.cardDb), 0);
        return dele > meu + 300 ? 126 : -1;
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
        // Tempestade Pesada e Espanador levam o campo inteiro, o do bot junto.
        // Contar só as cartas do oponente é como o bot detonava as próprias
        // armadilhas recém-baixadas para limpar duas do outro lado — troca de
        // três por duas, apresentada como jogada.
        const meuBackrow = ocupadas(mine.spells).length;
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
    const intel = readIntel(card.code, ctx.cardDb);
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

    return score;
  }

  /** Quanto vale baixar este monstro virado para baixo. */
  private scoreSet(card: OcgCardLoc, ctx: BotContext): number {
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
      const { score } = appraiseAttack(atk, ocupadas(foe.monsters).length === 0, foe);
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
      const { score } = appraiseAttack(atk, semDefesa, foe);
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

    let melhor: (Plan & { target: BoardCard | null }) | null = null;

    message.chains.forEach((card, index) => {
      const score = this.scoreActivation(card, ctx, mine, foe);
      if (score > 0 && (!melhor || score > melhor.score)) {
        melhor = {
          score,
          response: cmd(SelectBattleCMDAction.SELECT_CHAIN, index),
          activated: card,
          target: null,
        };
      }
    });

    message.attacks.forEach((card, index) => {
      const meu =
        card.location === OcgLocation.MZONE ? mine.monsters[card.sequence] : null;
      const atk =
        (meu ? knownStats(meu)?.attack : null) ??
        readIntel(card.code, ctx.cardDb).atk;
      const { score, target } = appraiseAttack(atk, card.can_direct, foe);
      if (score > 0 && (!melhor || score > melhor.score)) {
        melhor = {
          score,
          response: cmd(SelectBattleCMDAction.SELECT_BATTLE, index),
          target,
        };
      }
    });

    if (!melhor) return encerrar();

    const escolhido = melhor as Plan & { target: BoardCard | null };
    // Guardado para o SELECT_CARD em que o core pergunta quem apanha.
    this.plannedTarget = escolhido.target
      ? {
          controller: escolhido.target.controller,
          sequence: escolhido.target.sequence,
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
    if (message.forced) return responder(0);

    this.chainSteps += 1;
    if (this.chainSteps > CHAIN_BUDGET) return responder(null);

    const board = ctx.readBoard(false);
    const [mine, foe] = lados(board, ctx.me);

    let melhorIndex: number | null = null;
    let melhorScore = CHAIN_THRESHOLD;

    message.selects.forEach((card, index) => {
      const score = this.scoreChain(card, ctx, mine, foe);
      if (score > melhorScore) {
        melhorScore = score;
        melhorIndex = index;
      }
    });

    if (melhorIndex === null) return responder(null);
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
    const usos = this.activations.get(chave(card)) ?? 0;
    if (usos >= SAME_CARD_ACTIVATIONS) return -1;

    const intel = readIntel(card.code, ctx.cardDb);
    const role = roleOf(card.code);
    // Sem informação de turno, presume o do adversário: é onde uma armadilha
    // oferecida quase sempre está, e errar para o lado de responder custa uma
    // carta — errar para o lado de guardar custa o duelo.
    const turnoDele = ctx.turnPlayer === null || ctx.turnPlayer !== ctx.me;
    const monstrosDele = ocupadas(foe.monsters);
    const eloMeu = ctx.chainPlayer === ctx.me;
    const eloDele = ctx.chainPlayer !== undefined && ctx.chainPlayer !== null && ctx.chainPlayer !== ctx.me;

    // Hand trap — efeito de monstro ativado DA MÃO. Nunca contra o próprio
    // elo: a Ash Blossom pega qualquer "adicionar do Deck", inclusive o do
    // bot, e ele negava a própria busca. Fora disso, é a resposta ao
    // adversário: vale contra um elo dele, no turno dele, ou na batalha
    // (Kuriboh, Honest). No próprio turno sem nada dele em jogo, guarda.
    if (card.location === OcgLocation.HAND && intel.isMonster) {
      if (eloMeu) return -1;
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
        return dele > meu + 300 ? 87 : -1;
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

    // Contra-armadilha custa caro (Julgamento Solene leva metade dos LP). Sem
    // saber o que está sendo negado, guardar é a decisão de menor arrependimento.
    if (intel.isCounter) return 30;
    // Efeito de monstro que o core ofereceu na corrente costuma ser um gatilho
    // de graça — o custo, se houver, já foi cobrado pelo script.
    if (intel.isMonster) return 62;
    if (intel.isTrap) return turnoDele ? 55 : 25;
    if (intel.isQuickplay) return turnoDele ? 52 : 34;
    return turnoDele ? 48 : 30;
  }

  // ── Seleções de carta ──────────────────────────────────────────────────

  private selectCard(
    message: OcgMessageSelectCard,
    ctx: BotContext,
  ): OcgResponse | null {
    const candidatos = message.selects;
    if (candidatos.length === 0) return null;

    // O alvo do ataque que o bot acabou de escolher.
    if (this.plannedTarget) {
      const alvo = this.plannedTarget;
      const index = candidatos.findIndex(
        (c) =>
          c.location === OcgLocation.MZONE &&
          c.controller === alvo.controller &&
          c.sequence === alvo.sequence,
      );
      if (index >= 0) {
        this.plannedTarget = null;
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
      case OcgLocation.DECK:
        // Custo (descarte) ou busca — o sinal é invertido no primeiro caso, e
        // não dá para distinguir. Preferir a carta de menor valor erra pouco:
        // num descarte é o certo, e numa busca de deck o formato quase sempre
        // busca peça específica, não a maior.
        return card.location === OcgLocation.HAND ? -valor : valor;
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
      if (score > melhorScore) {
        melhorScore = score;
        melhor = index;
      }
    });
    // Já dá para encerrar e o que sobra é CUSTO (carta própria: material,
    // descarte): para no mínimo. Seguir marcando enquanto houvesse candidata
    // entregava cartas a mais — "envie até 3" virava sempre 3.
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

    const escolhida = ordem.find((pos) => permitidas.includes(pos)) ?? permitidas[0];
    return { type: OcgResponseType.SELECT_POSITION, position: escolhida };
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
    if (plan.activated) this.noteActivation(plan.activated);
    if (plan.setsBackrow) this.setsNoTurno += 1;
    return plan.response;
  }

  private noteActivation(card: OcgCardLoc): void {
    const key = chave(card);
    this.activations.set(key, (this.activations.get(key) ?? 0) + 1);
  }
}
