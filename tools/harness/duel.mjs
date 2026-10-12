/**
 * Duelo headless e roteirizável — a mesma engine que o app usa, sem navegador.
 *
 * Existe para poder perguntar de cada carta a única coisa que realmente
 * importa: "dá para ativar isso, e o efeito resolve sem estourar?". No app essa
 * pergunta só se responde clicando; aqui ela vira um teste.
 *
 * O laço de mensagens é o mesmo do `DuelSession`, mas com duas diferenças
 * deliberadas: sem pausas (nada é assistido) e com um piloto automático que
 * responde os dois jogadores, para o teste chegar até o fim do efeito.
 */
import {
  OcgDuelMode,
  OcgLocation,
  OcgLogType,
  OcgMessageType,
  OcgPosition,
  OcgProcessResult,
  OcgQueryFlags,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
  ocgPositionParse,
} from "@n1xx1/ocgcore-wasm";

import { loadCardDb, loadCore, readScriptFile } from "./env.mjs";

/**
 * Um único core para todos os duelos do processo.
 *
 * Instanciar o wasm custa ~150 ms; o pool Goat tem mais de mil e seiscentas
 * cartas e cada uma roda em mais de um cenário. Um core por duelo transformava
 * a bateria inteira em dezenas de minutos de puro boot.
 */
let sharedCore = null;
/** Sink de erros do duelo em execução — trocado a cada `createDuel`. */
let errorSink = [];

async function getCore() {
  sharedCore ??= await loadCore((message) => errorSink.push(message));
  return sharedCore;
}

/** Scripts base que precisam estar carregados antes de qualquer carta. */
const CORE_SCRIPTS = ["constant.lua", "utility.lua"];

/**
 * Teto de iterações do laço. Um efeito que se auto-encadeia (ou um prompt que
 * o piloto responde de um jeito que o core rejeita) fica girando para sempre —
 * o teste precisa terminar de qualquer jeito.
 */
const MAX_STEPS = 4000;

/**
 * Um `Error: eof` do binding é recuperável (ver comentário em `run()`); muitos
 * seguidos sem nenhuma mensagem válida no meio é que indicam algo mais grave.
 */
const MAX_CONSECUTIVE_BINDING_ERRORS = 3;

/** Sentinela que uma política devolve para encerrar o duelo ali mesmo. */
export const STOP = Symbol("STOP");

export const Zone = {
  DECK: OcgLocation.DECK,
  HAND: OcgLocation.HAND,
  MZONE: OcgLocation.MZONE,
  SZONE: OcgLocation.SZONE,
  GRAVE: OcgLocation.GRAVE,
  REMOVED: OcgLocation.REMOVED,
  EXTRA: OcgLocation.EXTRA,
};

/**
 * Modo "antes do conserto": reproduz o adaptador antigo, que descartava
 * `setcodes` e `alias`. Serve para medir o efeito da correção — rodar a mesma
 * bateria nos dois modos e comparar quais cartas mudaram de veredito.
 */
const LEGACY = process.env.LEGACY_CARD_DATA === "1";

/** TYPE_LINK do core. */
const TYPE_LINK = 0x4000000;

/**
 * Num monstro Link a coluna `def` do `cards.cdb` são as SETAS, não DEF — o
 * mesmo ajuste de `linkFields` em `card-adapter.ts` (que o harness não importa
 * porque usa o atalho `@/`).
 */
function linkFields(type, def) {
  return type & TYPE_LINK ? { defense: 0, link_marker: def } : { defense: def, link_marker: 0 };
}

function toOcgData(code, db) {
  const official = db.get(code);
  if (official) {
    if (LEGACY) {
      return {
        code, alias: 0, setcodes: [], type: official.type,
        level: official.level, attribute: official.attribute,
        race: BigInt(official.race), attack: official.atk, defense: official.def,
        lscale: official.lscale, rscale: official.rscale, link_marker: 0,
      };
    }
    return {
      code,
      alias: official.alias,
      setcodes: official.setcodes,
      type: official.type,
      level: official.level,
      attribute: official.attribute,
      race: BigInt(official.race),
      attack: official.atk,
      lscale: official.lscale,
      rscale: official.rscale,
      ...linkFields(official.type, official.def),
    };
  }
  // Ficha neutra: devolver null aqui aborta a carta que criou o código.
  return {
    code, alias: 0, setcodes: [], type: 0x1 | 0x10 | 0x4000,
    level: 1, attribute: 0, race: 0n, attack: 0, defense: 0,
    lscale: 0, rscale: 0, link_marker: 0,
  };
}

/**
 * Um duelo pronto para ser interrogado.
 *
 * `place` descreve o campo inicial: cada entrada vira uma carta já em jogo,
 * o que evita ter que jogar dez turnos só para testar um efeito de cemitério.
 */
export class HarnessDuel {
  constructor({ core, handle, db, cards }) {
    this.core = core;
    this.handle = handle;
    this.db = db;
    this.cards = cards;
    /** Erros que o core reportou (Lua quebrado, script ausente...). */
    this.errors = [];
    /** Toda mensagem emitida, para o teste inspecionar o que aconteceu. */
    this.messages = [];
    this.lifePoints = [8000, 8000];
    this.winner = null;
    /** Prompts que ninguém soube responder — a causa de duelo travado. */
    this.unanswered = [];
    this.steps = 0;
    this.retries = 0;
    /** Falhas seguidas de desserialização do binding (ver `run()`). */
    this.consecutiveBindingErrors = 0;
  }

  /** Nome legível de um passcode, quando o pool foi carregado. */
  name(code) {
    return this.cards?.get(code)?.name ?? `#${code}`;
  }

  /**
   * Roda até o duelo pedir algo que a política não responda, ou terminar.
   *
   * @param policy função `(message, duel) => resposta | null`. Devolver `null`
   *   delega ao piloto automático. É por aqui que um teste "toma o controle"
   *   num ponto específico (ativar a carta X, escolher o alvo Y).
   */
  run(policy = () => null, { play = false } = {}) {
    while (this.steps < MAX_STEPS) {
      this.steps += 1;
      let status;
      let batch;
      try {
        status = this.core.duelProcess(this.handle);
        batch = this.core.duelGetMessage(this.handle);
      } catch (error) {
        // O binding do ocgcore-wasm não sabe desserializar algumas mensagens e
        // lança ("Error: eof") — visto com SHUFFLE_SET_CARD, onde o parser lê
        // a contagem de cartas como u32 (4 bytes) quando o core escreve um u8
        // (1 byte), desalinhando o resto da mensagem até estourar o limite do
        // buffer. `duelProcess` já rodou e o core já aplicou o passo ANTES de
        // `duelGetMessage` falhar — só a notificação para a UI é que se perde,
        // o estado do duelo continua correto. Tratar isso como fatal mata o
        // duelo por causa de uma mensagem cosmética; em vez disso, o lote
        // perdido é descartado e o laço tenta de novo. Um teto evita girar
        // para sempre se a causa for outra (aí sim é uma falha de verdade).
        this.bindingError = String(error?.message ?? error);
        this.consecutiveBindingErrors += 1;
        if (this.consecutiveBindingErrors > MAX_CONSECUTIVE_BINDING_ERRORS) return "BINDING_ERROR";
        continue;
      }
      this.consecutiveBindingErrors = 0;
      this.consume(batch);

      if (this.winner !== null) return "WIN";
      if (status === OcgProcessResult.END) return "END";
      if (status === OcgProcessResult.CONTINUE) continue;

      const retried = batch.some((m) => m.type === OcgMessageType.RETRY);
      this.retries = retried ? this.retries + 1 : 0;
      if (this.retries > 8) return "RETRY_LOOP";

      const prompt = findPrompt(batch) ?? (retried ? this.lastPrompt : null);
      if (!prompt) {
        // Nenhuma pergunta reconhecível e o core está esperando: é exatamente
        // assim que o duelo congela no app.
        const waiting = batch.filter((m) => m.type !== OcgMessageType.WAITING);
        this.unanswered.push(...waiting.map((m) => m.type));
        return "STUCK";
      }
      this.lastPrompt = prompt;

      const decision = policy(prompt, this);
      if (decision === STOP) return "STOPPED";
      // `attempt` > 0 quer dizer que o core recusou a resposta anterior para
      // ESTA pergunta: o piloto troca de resposta em vez de repetir a mesma
      // até o teto. É o caso do monstro que "deve atacar se puder" (os
      // Karakuri): passar a Battle Phase sem atacar não é legal com ele em
      // campo, e o piloto passivo entrava em laço de RETRY por culpa dele.
      const chosen = decision ?? autoPilot(prompt, { play, attempt: this.retries });
      if (!chosen) {
        this.unanswered.push(prompt.type);
        return "STUCK";
      }
      this.core.duelSetResponse(this.handle, chosen);
    }
    return "MAX_STEPS";
  }

  consume(batch) {
    for (const message of batch) {
      this.messages.push(message);
      switch (message.type) {
        case OcgMessageType.DAMAGE:
        case OcgMessageType.PAY_LPCOST:
          this.lifePoints[message.player] -= message.amount;
          break;
        case OcgMessageType.RECOVER:
          this.lifePoints[message.player] += message.amount;
          break;
        case OcgMessageType.LPUPDATE:
          this.lifePoints[message.player] = message.lp;
          break;
        case OcgMessageType.WIN:
          this.winner = message.player;
          break;
        default:
          break;
      }
    }
  }

  /** Todas as mensagens de um tipo emitidas até agora. */
  of(type) {
    return this.messages.filter((m) => m.type === type);
  }

  /**
   * Conteúdo de uma zona, como o core a enxerga.
   *
   * As flags precisam vir das constantes: escritas à mão elas silenciosamente
   * pedem os campos errados, e o resultado é uma carta sem `code` — que parece
   * zona vazia para quem estiver contando.
   */
  query(controller, location) {
    return this.core.duelQueryLocation(this.handle, {
      flags:
        OcgQueryFlags.CODE |
        OcgQueryFlags.POSITION |
        OcgQueryFlags.ATTACK |
        OcgQueryFlags.DEFENSE,
      controller,
      location,
    });
  }

  /** Quantas cartas há de fato numa zona (as posições vazias vêm como null). */
  countIn(controller, location) {
    return this.query(controller, location).filter((card) => card?.code).length;
  }

  destroy() {
    this.core.destroyDuel(this.handle);
  }
}

/** Prompts que exigem resposta — inclui os quatro `ANNOUNCE_*`. */
const PROMPT_TYPES = new Set([
  OcgMessageType.SELECT_BATTLECMD, OcgMessageType.SELECT_IDLECMD,
  OcgMessageType.SELECT_EFFECTYN, OcgMessageType.SELECT_YESNO,
  OcgMessageType.SELECT_OPTION, OcgMessageType.SELECT_CARD,
  OcgMessageType.SELECT_CHAIN, OcgMessageType.SELECT_PLACE,
  OcgMessageType.SELECT_POSITION, OcgMessageType.SELECT_TRIBUTE,
  OcgMessageType.SELECT_COUNTER, OcgMessageType.SELECT_SUM,
  OcgMessageType.SELECT_DISFIELD, OcgMessageType.SORT_CARD,
  OcgMessageType.SELECT_UNSELECT_CARD, OcgMessageType.ROCK_PAPER_SCISSORS,
  OcgMessageType.ANNOUNCE_RACE, OcgMessageType.ANNOUNCE_ATTRIB,
  OcgMessageType.ANNOUNCE_CARD, OcgMessageType.ANNOUNCE_NUMBER,
]);

export function findPrompt(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (PROMPT_TYPES.has(messages[i].type)) return messages[i];
  }
  return null;
}

/**
 * Os `count` primeiros bits ligados de uma máscara de opções (raça/atributo).
 *
 * Devolve BigInt porque `OcgRace` é de 64 bits neste binding — o encoder da
 * resposta faz `o |= r` sobre um acumulador BigInt, e um Number ali estoura
 * com "Cannot mix BigInt and other types". Atributo é de 32 bits e usa Number.
 */
function firstBits(mask, count, { asBigInt = false } = {}) {
  const value = BigInt(mask);
  const found = [];
  for (let bit = 0n; bit < 64n && found.length < count; bit += 1n) {
    if ((value >> bit) & 1n) {
      const flag = 1n << bit;
      found.push(asBigInt ? flag : Number(flag));
    }
  }
  return found.length ? found : [asBigInt ? 1n : 1];
}

/**
 * Índices de `selects` que somam o alvo de um SELECT_SUM.
 *
 * Soma EXATA primeiro, com o menor número de cartas: há cartas que pedem
 * "exatamente N" (`Duel.SelectWithSumEqual`), e o "pega até passar" de antes
 * dava RETRY nelas. Só sem combinação exata cai no "igual ou maior", que é o
 * que o Ritual aceita.
 */
function sumIndices(message) {
  const target = message.amount - message.selects_must.reduce((t, c) => t + (c.amount & 0xffff), 0);
  if (target <= 0) return [];
  const values = message.selects.map((card) => card.amount & 0xffff);
  const n = Math.min(values.length, 16);
  let best = null;
  for (let mask = 1; mask < 1 << n; mask += 1) {
    let total = 0;
    const picked = [];
    for (let i = 0; i < n; i += 1) {
      if (mask & (1 << i)) {
        total += values[i];
        picked.push(i);
      }
    }
    if (total === target && (!best || picked.length < best.length)) best = picked;
  }
  if (best) return best;
  const picked = [];
  let total = 0;
  values.forEach((value, index) => {
    if (total >= target) return;
    picked.push(index);
    total += value;
  });
  return picked;
}

function placesFrom(mask, player, count) {
  const places = [];
  const LOCATIONS = [
    [OcgLocation.MZONE, 0], [OcgLocation.SZONE, 8],
    [OcgLocation.MZONE, 16], [OcgLocation.SZONE, 24],
  ];
  for (let index = 0; index < 4 && places.length < count; index += 1) {
    const [location, shift] = LOCATIONS[index];
    const owner = index < 2 ? player : 1 - player;
    const free = (~(Number(mask) >> shift)) & 0xff;
    for (let sequence = 0; sequence < 8 && places.length < count; sequence += 1) {
      if (free & (1 << sequence)) places.push({ player: owner, location, sequence });
    }
  }
  return places;
}

/**
 * Responde qualquer prompt de um jeito legal.
 *
 * Não tenta jogar bem — tenta *não travar*. É o suficiente para levar um
 * efeito até o fim e ver se ele estoura no caminho.
 *
 * @param play quando ligado, o piloto realmente **joga**: ativa efeitos,
 *   invoca, baixa e ataca, em vez de passar o turno. É o que faz o duelo
 *   produzir a variedade de prompts que o teste de UI precisa examinar — com
 *   o piloto passivo o engine só chega a pedir três tipos de decisão.
 */
export function autoPilot(message, { play = false, attempt = 0 } = {}) {
  switch (message.type) {
    case OcgMessageType.SELECT_IDLECMD: {
      if (play) {
        const moves = [
          [message.activates, SelectIdleCMDAction.SELECT_ACTIVATE],
          [message.summons, SelectIdleCMDAction.SELECT_SUMMON],
          [message.special_summons, SelectIdleCMDAction.SELECT_SPECIAL_SUMMON],
          [message.spell_sets, SelectIdleCMDAction.SELECT_SPELL_SET],
          [message.monster_sets, SelectIdleCMDAction.SELECT_MONSTER_SET],
        ];
        for (const [list, action] of moves) {
          if (list.length > 0) {
            return {
              type: OcgResponseType.SELECT_IDLECMD,
              action,
              // Varia a escolha para não repetir a mesma jogada todo turno.
              index: Math.min(list.length - 1, message.activates.length % list.length),
            };
          }
        }
      }
      if (message.to_bp)
        return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null };
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null };
    }
    case OcgMessageType.SELECT_BATTLECMD:
      // Num RETRY, ataca — e com um atacante diferente a cada tentativa, para
      // achar o monstro que é obrigado a atacar.
      if ((play || attempt > 0) && message.attacks.length > 0) {
        return {
          type: OcgResponseType.SELECT_BATTLECMD,
          action: SelectBattleCMDAction.SELECT_BATTLE,
          index: attempt > 0 ? (attempt - 1) % message.attacks.length : 0,
        };
      }
      if (play && message.to_m2)
        return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_M2, index: null };
      return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_EP, index: null };
    case OcgMessageType.SELECT_EFFECTYN:
      return { type: OcgResponseType.SELECT_EFFECTYN, yes: true };
    case OcgMessageType.SELECT_YESNO:
      return { type: OcgResponseType.SELECT_YESNO, yes: true };
    case OcgMessageType.SELECT_OPTION:
      return { type: OcgResponseType.SELECT_OPTION, index: 0 };
    case OcgMessageType.SELECT_CARD:
      return {
        type: OcgResponseType.SELECT_CARD,
        indicies: Array.from({ length: Math.max(message.min, 1) }, (_, i) => i),
      };
    case OcgMessageType.SELECT_TRIBUTE:
      return {
        type: OcgResponseType.SELECT_TRIBUTE,
        // Limitado aos candidatos que EXISTEM: `min` é a soma de tributos
        // exigida, não a contagem de cartas, e há monstro que vale por dois
        // (Kaiser Sea Horse, Double Coston). Pedir `min` índices quando só há
        // um candidato manda o core um índice inexistente, e ele responde
        // RETRY para sempre — o duelo trava sem erro nenhum no log.
        indicies: message.selects
          .slice(0, Math.max(message.min, 1))
          .map((_, i) => i),
      };
    case OcgMessageType.SELECT_UNSELECT_CARD:
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: 0 };
    case OcgMessageType.SELECT_CHAIN:
      return {
        type: OcgResponseType.SELECT_CHAIN,
        index: message.forced && message.selects.length > 0 ? 0 : null,
      };
    case OcgMessageType.SELECT_PLACE:
      return { type: OcgResponseType.SELECT_PLACE, places: placesFrom(message.field_mask, message.player, message.count) };
    case OcgMessageType.SELECT_DISFIELD:
      return { type: OcgResponseType.SELECT_DISFIELD, places: placesFrom(message.field_mask, message.player, message.count) };
    case OcgMessageType.SELECT_POSITION: {
      const allowed = ocgPositionParse(message.positions);
      return { type: OcgResponseType.SELECT_POSITION, position: allowed[0] ?? OcgPosition.FACEUP_ATTACK };
    }
    case OcgMessageType.SELECT_COUNTER:
      return { type: OcgResponseType.SELECT_COUNTER, counters: message.cards.map(() => 0) };
    case OcgMessageType.SELECT_SUM:
      // Precisa somar `amount`; escolher "as N primeiras" é resposta inválida.
      return { type: OcgResponseType.SELECT_SUM, indicies: sumIndices(message) };
    case OcgMessageType.SORT_CARD:
      return { type: OcgResponseType.SORT_CARD, order: null };
    case OcgMessageType.ROCK_PAPER_SCISSORS:
      return { type: OcgResponseType.ROCK_PAPER_SCISSORS, value: 1 };
    // `count` valores distintos: Earthshaker declara DOIS atributos, e um só
    // era resposta inválida (RETRY em laço).
    case OcgMessageType.ANNOUNCE_RACE:
      return {
        type: OcgResponseType.ANNOUNCE_RACE,
        races: firstBits(message.available, message.count, { asBigInt: true }),
      };
    case OcgMessageType.ANNOUNCE_ATTRIB:
      return {
        type: OcgResponseType.ANNOUNCE_ATTRIB,
        attributes: firstBits(message.available, message.count),
      };
    // O core espera o ÍNDICE dentro de `options`, não o número em si.
    case OcgMessageType.ANNOUNCE_NUMBER:
      return { type: OcgResponseType.ANNOUNCE_NUMBER, value: 0 };
    case OcgMessageType.ANNOUNCE_CARD:
      return { type: OcgResponseType.ANNOUNCE_CARD, card: 46986414 };
    default:
      return null;
  }
}

/**
 * Monta um duelo com o campo já arrumado.
 *
 * @param place lista de `{ player, zone, code, position? }` — o estado inicial.
 * @param decks `[cartas do jogador 0, cartas do jogador 1]`, o que sobra no Deck.
 */
export async function createDuel({
  place = [],
  decks = [[], []],
  cards = null,
  seed = 42n,
  /** LP inicial de cada lado — algumas cartas só existem em LP baixo. */
  lifePoints = [8000, 8000],
  /**
   * Mão inicial de cada lado.
   *
   * Zero por padrão porque o teste de carta monta a mão à mão (`place`) e uma
   * compra inicial só atrapalharia. Um duelo de verdade precisa das cinco: sem
   * mão não há jogada para avaliar, e medir um bot num jogo onde ninguém tem
   * carta não mede nada.
   */
  startingDraw = 0,
  /**
   * Regras do duelo (`OcgDuelMode`). Goat por padrão — é o formato da bateria
   * antiga; as baterias do pool TCG passam `OcgDuelMode.MODE_MR5`.
   */
  mode = OcgDuelMode.MODE_GOAT,
} = {}) {
  const db = loadCardDb();
  const errors = [];
  const core = await getCore();
  errorSink = errors;

  const handle = core.createDuel({
    flags: mode,
    // Semente fixa: um teste que falha precisa falhar de novo.
    seed: [seed, seed + 1n, seed + 2n, seed + 3n],
    team1: { startingLP: lifePoints[0], startingDrawCount: startingDraw, drawCountPerTurn: 1 },
    team2: { startingLP: lifePoints[1], startingDrawCount: startingDraw, drawCountPerTurn: 1 },
    cardReader: (code) => toOcgData(code, db),
    scriptReader: (name) => {
      const match = name.match(/c(\d+)\.lua$/i);
      if (!match) return readScriptFile(name);
      // Mesma resolução de alias do app: arte alternativa usa o script da
      // carta original.
      const code = Number(match[1]);
      return (
        readScriptFile(`c${db.scriptPasscode(code)}.lua`) ??
        readScriptFile(`c${code}.lua`)
      );
    },
    errorHandler: (type, text) => {
      if (type === OcgLogType.ERROR) errors.push(text);
    },
  });

  if (!handle) throw new Error("createDuel devolveu null");

  for (const name of CORE_SCRIPTS) {
    const source = readScriptFile(name);
    if (!source) throw new Error(`script base ausente: ${name}`);
    if (!(await core.loadScript(handle, name, source))) {
      throw new Error(`o core rejeitou ${name}`);
    }
  }

  const duel = new HarnessDuel({ core, handle, db, cards });
  duel.errors = errors;
  duel.lifePoints = [...lifePoints];

  for (const [player, deck] of decks.entries()) {
    for (const code of deck) {
      core.duelNewCard(handle, {
        team: player, duelist: 0, code, controller: player,
        location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN,
      });
    }
  }

  for (const entry of place) {
    const { player = 0, zone, code } = entry;
    // O Extra Deck nasce VIRADO PARA BAIXO, como no app (`duel-session.ts`).
    // Não é detalhe: em Master Rule 4/5 o core só libera as Zonas de Monstro
    // principais para carta do Extra Deck que estava virada para baixo
    // (`get_rule_zone_fromex`). Virado para cima — o padrão antigo daqui —,
    // Sincro e Xyz pareciam presos à Zona de Monstro Extra, e foi exatamente
    // isso que enganou a primeira medição do pool TCG.
    const position =
      entry.position ??
      (zone === OcgLocation.MZONE
        ? OcgPosition.FACEUP_ATTACK
        : zone === OcgLocation.SZONE || zone === OcgLocation.EXTRA
          ? OcgPosition.FACEDOWN
          : OcgPosition.FACEUP);
    core.duelNewCard(handle, {
      team: player, duelist: 0, code, controller: player,
      location: zone, sequence: entry.sequence ?? 0, position,
    });
  }

  await core.startDuel(handle);
  return duel;
}
