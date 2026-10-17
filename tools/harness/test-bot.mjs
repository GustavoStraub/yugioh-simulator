/**
 * O bot joga melhor? — mede, não opina.
 *
 * A pergunta que este teste responde é a única que importa depois de mexer nas
 * heurísticas: **o bot novo ganha do antigo?** Tudo o mais (a jogada parecer
 * inteligente, o código estar bonito) é indício; o placar é prova.
 *
 * Como mede: o mesmo deck dos dois lados, cérebro novo contra o respondedor
 * antigo (`botAutoResponse`, que invoca a primeira carta e ataca com a
 * primeira). Metade das partidas com os assentos trocados — quem começa tem
 * vantagem em Goat, e sem inverter o teste mediria a moeda, não o bot.
 *
 * Antes do placar vêm os **cenários dirigidos**: tabuleiros montados à mão em
 * que só existe uma jogada defensável. O placar diz que o bot é mais forte; os
 * cenários dizem *por quê*, e são eles que quebram quando uma heurística
 * regride sem que a taxa de vitória se mova o bastante para denunciar.
 *
 * Também vigia a regressão que dói de verdade: duelo **travado**. Um bot que
 * joga melhor mas congela a tela é pior que o burro que terminava sempre.
 *
 * Dois adversários, porque "melhor que o bot burro" é uma régua curta:
 *
 * - `passivo` — o respondedor antigo (`botAutoResponse`): invoca a primeira
 *   carta da lista, ataca com a primeira e nunca ativa nem encadeia nada.
 * - `guloso` — o piloto automático do harness em modo `play`: **ativa** tudo o
 *   que pode, invoca, baixa e ataca sempre. Não avalia nada, mas joga todas as
 *   cartas, e é uma régua bem mais dura que o passivo.
 *
 * Formato: `goat` (padrão) usa os 10 decks Goat em MODE_GOAT; `tcg` usa os
 * ~100 decks pré-montados do TCG em Master Rule 2020, com o Extra Deck de cada
 * um — é onde aparecem Sincro, Xyz, Link e Pêndulo, que o bot precisa saber
 * avaliar (Fase 8).
 *
 * Uso: node --import ./tools/harness/ts-loader-register.mjs tools/harness/test-bot.mjs [partidas] [passivo|guloso] [goat|tcg]
 *   [--extra N] [--contra] [--partidas 59,100]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  OcgDuelMode,
  OcgMessageType,
  OcgPosition,
  OcgResponseType,
  OcgType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
} from "@n1xx1/ocgcore-wasm";

import { autoResponseFor } from "@/lib/duel/auto-response.ts";
import { botAutoResponse } from "@/lib/duel/bot-responder.ts";
import { BotBrain } from "@/lib/duel/bot/bot-brain.ts";
import { readBoardState } from "@/lib/duel/board-state.ts";
import { createDuelSession } from "@/lib/duel/duel-session.ts";
import { CardRegistry } from "@/lib/domain/card-registry.ts";
import { OfficialCardDb } from "@/lib/duel/official-card-data.ts";
import { nodeAssets } from "@/server/duel/node-assets.ts";

import { autoPilot, createDuel, STOP, Zone } from "./duel.mjs";
import { REPO } from "./env.mjs";
import { createBotObserver } from "./bot-observer.mjs";
import { loadBotProfile } from "@/lib/duel/bot/deck-profile";
const MainBrain = process.env.BOT_MAIN ? (await import(process.env.BOT_MAIN)).BotBrain : BotBrain;

const PARTIDAS = Number(process.argv[2] ?? 60);
const RIVAL = process.argv[3] ?? "passivo";
const FORMATO = process.argv[4] === "tcg" ? "tcg" : "goat";
/** `--partidas 59,100`: repete só essas (mesma semente, deck e assento). */
const partidasAt = process.argv.indexOf("--partidas");
const SO_PARTIDAS =
  partidasAt >= 0 ? new Set(process.argv[partidasAt + 1].split(",").map(Number)) : null;
// O guloso recebe o banco oficial (declarar um nome que o filtro do core
// aceita) e o número da tentativa (num RETRY, trocar de resposta): sem isso
// ele mesmo travava duelos — e o placar contava contra o bot um defeito do
// adversário de referência.
/**
 * `cerebro`: outro BotBrain, carregado do módulo em `BOT_RIVAL` — é o A/B de
 * uma mudança no bot. Copie a versão anterior para um diretório dentro de
 * `src/` (os imports internos relativos) e rode, por exemplo:
 *
 *   BOT_RIVAL=@/lib/duel/bot/_antigo/bot-brain node … test-bot.mjs 88 cerebro tcg --extra 3
 *
 * O placar passa a ser "bot novo × bot antigo", nos mesmos decks e sementes.
 */
const CerebroRival =
  RIVAL === "cerebro"
    ? (await import(process.env.BOT_RIVAL ?? "@/lib/duel/bot/bot-brain")).BotBrain
    : null;
/** `--extra N`: só decks com pelo menos N cartas no Extra Deck. */
const extraAt = process.argv.indexOf("--extra");
const EXTRA_MINIMO = extraAt >= 0 ? Number(process.argv[extraAt + 1]) : 0;
/**
 * `--contra`: só decks com contra-armadilha no Main. Uma mudança nelas não
 * mexe em nada nos outros decks — misturá-los no placar só dilui o efeito no
 * ruído.
 */
const SO_CONTRA = process.argv.includes("--contra");

const responderRival =
  RIVAL === "guloso"
    ? (message, duel) => autoPilot(message, { play: true, attempt: duel.retries, db: duel.db })
    : (message) => botAutoResponse(message);

/**
 * Embaralhamento determinístico.
 *
 * `createDuel` empilha o deck na ordem da decklist e o core não redistribui —
 * e as decklists listam monstros primeiro, armadilhas por último. Sem
 * embaralhar, **toda** mão inicial saía com seis armadilhas e nenhum monstro,
 * e o teste media dois bots impedidos de jogar. O app já embaralha (`shuffled`
 * em `duel-session`); aqui a mesma coisa, com semente, para a partida que
 * falhar poder ser repetida.
 */
function embaralhar(cartas, seed) {
  let estado = Number(seed) >>> 0;
  const proximo = () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const copia = [...cartas];
  for (let i = copia.length - 1; i > 0; i -= 1) {
    const j = Math.floor(proximo() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

const cardDb = new OfficialCardDb(
  JSON.parse(readFileSync(join(REPO, "src/data/card-db.json"), "utf8")),
);

const PRESETS = JSON.parse(
  readFileSync(
    join(REPO, FORMATO === "tcg" ? "src/data/preset-decks-tcg.json" : "src/data/preset-decks.json"),
    "utf8",
  ),
);

/**
 * Acompanha turno e fase lendo as mensagens que o duelo já emitiu.
 *
 * O cérebro precisa saber de quem é o turno e em que fase está — é o que separa
 * "guardar a armadilha" de "responder ao ataque". O harness não rastreia nada
 * disso, então o cursor anda sobre `duel.messages` sem reprocessar o passado.
 */
function criarRastreador(duel) {
  let cursor = 0;
  let turnPlayer = null;
  let turnCount = 0;
  let phase = null;
  // Quem ativou o último elo da corrente aberta, e que carta — a mesma
  // informação que a sessão passa ao bot (`snapshot.chain`).
  let chainPlayer = null;
  let chainCode = null;
  // Monstro sendo Invocado (como `DuelSession.summoning`): vai até o SUMMONED
  // ou até o CHAIN_END de uma Invocação negada, que não recebe SUMMONED.
  let summoning = null;
  return () => {
    for (; cursor < duel.messages.length; cursor += 1) {
      const message = duel.messages[cursor];
      if (message.type === OcgMessageType.NEW_TURN) {
        turnPlayer = message.player;
        turnCount += 1;
        summoning = null;
      } else if (message.type === OcgMessageType.NEW_PHASE) {
        phase = message.phase;
        summoning = null;
      } else if (message.type === OcgMessageType.CHAINING) {
        chainPlayer = message.controller;
        chainCode = message.code;
      } else if (message.type === OcgMessageType.CHAIN_END) {
        chainPlayer = null;
        chainCode = null;
        summoning = null;
      } else if (
        message.type === OcgMessageType.SUMMONING ||
        message.type === OcgMessageType.SPSUMMONING ||
        message.type === OcgMessageType.FLIPSUMMONING
      ) {
        summoning = { code: message.code, player: message.controller };
      } else if (
        message.type === OcgMessageType.SUMMONED ||
        message.type === OcgMessageType.SPSUMMONED ||
        message.type === OcgMessageType.FLIPSUMMONED
      ) {
        summoning = null;
      }
    }
    return { turnPlayer, turnCount, phase, chainPlayer, chainCode, summoning };
  };
}

/** Roda um duelo; devolve o vencedor e como o duelo terminou. */
async function duelar({ deck, extra = [], seed, assentoNovo }) {
  const duel = await createDuel({
    // Baralhos embaralhados **em separado**: com a mesma ordem dos dois lados o
    // duelo vira espelho e o placar mede a simetria, não a decisão.
    decks: [embaralhar(deck, seed), embaralhar(deck, seed * 31n + 7n)],
    place: [0, 1].flatMap((player) => extra.map((code) => ({ player, zone: Zone.EXTRA, code }))),
    seed,
    startingDraw: 5,
    mode: FORMATO === "tcg" ? OcgDuelMode.MODE_MR5 : OcgDuelMode.MODE_GOAT,
  });
  const rastrear = criarRastreador(duel);
  const ownDeck = { main: deck, extra, side: [], format: FORMATO };
  const profile = await loadBotProfile(ownDeck, FORMATO);
  const brain = new MainBrain({ difficulty: process.env.BOT_DIFFICULTY, deck: ownDeck, profile, format: FORMATO, seed: 17 });
  const rival = CerebroRival ? new CerebroRival({ difficulty: process.env.BOT_RIVAL_DIFFICULTY, deck: ownDeck, profile, format: FORMATO, seed: 17 }) : null;
  const observe = createBotObserver(duel, FORMATO);

  // A última resposta e quem a deu — num RETRY_LOOP o relatório diz o que o
  // core recusou e de quem era a culpa (o bot ou o adversário de referência).
  let ultima = null;
  /** As últimas decisões — num MAX_STEPS, mostram se é laço ou duelo longo. */
  const recentes = [];
  const politica = (message) => {
    const resposta = decidir(message);
    ultima = { message, resposta, quem: ultimaFonte };
    recentes.push(
      `${ultimaFonte}:${message.type}→${JSON.stringify(resposta, (_, v) => (typeof v === "bigint" ? `${v}n` : v))}`,
    );
    if (recentes.length > 12) recentes.shift();
    return resposta;
  };
  let ultimaFonte = null;
  const decidir = (message) => {
    const observed = observe(message);
    message = observed.prompt;
    // Mesmo caminho do app: o que não tem escolha real se responde sozinho.
    const automatico = autoResponseFor(message);
    ultimaFonte = "automática";
    if (automatico) return automatico;

    const seat = "player" in message && message.player === 1 ? 1 : 0;
    ultimaFonte = seat !== assentoNovo ? RIVAL : "bot";
    if (seat !== assentoNovo && !rival) return responderRival(message, duel);

    const { turnPlayer, turnCount, phase, chainPlayer, chainCode, summoning } = rastrear();
    const cache = new Map();
    return (seat === assentoNovo ? brain : rival).decide({
      prompt: message,
      me: seat,
      readBoard: (full) => {
        if (!cache.has(full)) {
          cache.set(full, readBoardState(duel.core, duel.handle, seat, !full));
        }
        return cache.get(full);
      },
      cardDb,
      lifePoints: duel.lifePoints,
      phase,
      turnPlayer,
      turnCount,
      chainPlayer,
      chainCode,
      summoning,
      ...observed,
    });
  };

  const desfecho = duel.run(politica, { play: false });
  const resultado = {
    ultima: desfecho === "RETRY_LOOP" ? ultima : null,
    recentes: desfecho === "MAX_STEPS" ? [...recentes] : [],
    desfecho,
    winner: duel.winner,
    turnos: rastrear().turnCount,
    lp: [...duel.lifePoints],
    contras: contrasAtivadas(duel, assentoNovo),
  };
  duel.destroy();
  return resultado;
}

const ehContra = (code) => {
  const data = cardDb.get(code);
  return data !== null && (data.type & OcgType.TRAP) !== 0 && (data.type & OcgType.COUNTER) !== 0;
};

/**
 * Contra-armadilhas ativadas no duelo, `[bot, rival]` — o placar diz quem
 * ganhou; isto diz se a carta chegou a ser usada.
 */
function contrasAtivadas(duel, assentoNovo) {
  const total = [0, 0];
  for (const m of duel.of(OcgMessageType.CHAINING)) {
    if (ehContra(m.code)) total[m.controller === assentoNovo ? 0 : 1] += 1;
  }
  return total;
}

/** Passcodes usados nos cenários — conferidos contra o pool Goat. */
const BATTLE_OX = 5053103; // 1700 ATK, sem efeito
const SUMMONED_SKULL = 70781052; // 2500 ATK
const BLUE_EYES = 89631139; // 3000 ATK
const POT_OF_GREED = 55144522;
const MIRROR_FORCE = 44095762;

/**
 * Monta um tabuleiro e devolve a decisão do bot no prompt que interessa.
 *
 * O bot senta no assento 0 para que o cenário aconteça já no primeiro turno —
 * do outro lado seria preciso jogar um turno inteiro do adversário antes de a
 * pergunta aparecer, e o que se quer isolar é a decisão, não o caminho até ela.
 */
/**
 * @param forcar opcional: `(message) => resposta | null` — joga a preparação
 *   do cenário pelo bot (ativar a carta que cria a situação), para a decisão
 *   capturada ser só a que interessa.
 * @param rival opcional: o mesmo, para o adversário (assento 1) — é ele quem
 *   ativa o Roubar ou faz a Invocação-Xyz a que o bot vai responder. O que
 *   ele não decide cai no respondedor passivo.
 */
async function cenario({
  place,
  capturar,
  mode = OcgDuelMode.MODE_GOAT,
  deck0 = null,
  forcar = null,
  rival = null,
}) {
  const deck = Array.from({ length: 40 }, () => BATTLE_OX);
  const duel = await createDuel({
    decks: [deck0 ?? deck, deck],
    seed: 9n,
    startingDraw: 0,
    place,
    mode,
  });
  const brain = new BotBrain();
  const observe = createBotObserver(duel, FORMATO);
  const rastrear = criarRastreador(duel);
  let capturado;

  duel.run((message) => {
    const automatico = autoResponseFor(message);
    if (automatico) return automatico;
    const seat = "player" in message && message.player === 1 ? 1 : 0;
    if (seat !== 0) return rival?.(message) ?? botAutoResponse(message);
    const forcada = forcar?.(message);
    if (forcada) return forcada;

    // O mesmo contexto que a sessão monta — turno, fase, corrente e Invocação
    // lidos das mensagens, não presumidos.
    const cache = new Map();
    const resposta = brain.decide({
      prompt: message,
      me: 0,
      readBoard: (full) => {
        if (!cache.has(full)) {
          cache.set(full, readBoardState(duel.core, duel.handle, 0, !full));
        }
        return cache.get(full);
      },
      cardDb,
      lifePoints: duel.lifePoints,
      ...rastrear(),
      ...observe(message),
    });

    const capturaAtual = capturar(message, resposta);
    if (capturaAtual !== undefined) {
      capturado = capturaAtual;
      return STOP;
    }
    return resposta;
  });

  duel.destroy();
  return capturado;
}

const monstro = (player, code, sequence = 0, position = OcgPosition.FACEUP_ATTACK) =>
  ({ player, zone: Zone.MZONE, code, sequence, position });

const falhasCenario = [];
function conferir(condicao, descricao, detalhe = "") {
  console.log(condicao ? `  ✓ ${descricao}` : `  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!condicao) falhasCenario.push(descricao);
}

const naBatalha = (message, resposta) =>
  message.type === OcgMessageType.SELECT_BATTLECMD ? resposta : undefined;

console.log("─── Cenários dirigidos ───");

{
  // A jogada que definia o bot antigo: atacar porque havia um ataque possível.
  const r = await cenario({
    place: [monstro(0, BATTLE_OX), monstro(1, SUMMONED_SKULL)],
    capturar: naBatalha,
  });
  conferir(
    r && r.action !== SelectBattleCMDAction.SELECT_BATTLE,
    "não ataca Summoned Skull (2500) com Battle Ox (1700)",
    r ? `ação ${r.action}` : "não chegou à Battle Phase",
  );
}

{
  const r = await cenario({
    place: [monstro(0, SUMMONED_SKULL), monstro(1, BATTLE_OX)],
    capturar: naBatalha,
  });
  conferir(
    r && r.action === SelectBattleCMDAction.SELECT_BATTLE,
    "ataca Battle Ox (1700) com Summoned Skull (2500)",
    r ? `ação ${r.action}` : "não chegou à Battle Phase",
  );
}

{
  const r = await cenario({
    place: [monstro(0, BATTLE_OX)],
    capturar: naBatalha,
  });
  conferir(
    r && r.action === SelectBattleCMDAction.SELECT_BATTLE,
    "ataca direto com o campo do oponente vazio",
    r ? `ação ${r.action}` : "não chegou à Battle Phase",
  );
}

{
  // Comprar antes de invocar: a Invocação-Normal é uma por turno, e decidi-la
  // com duas cartas a mais na mão é literalmente uma decisão melhor.
  const r = await cenario({
    place: [
      { player: 0, zone: Zone.HAND, code: POT_OF_GREED, sequence: 0, position: OcgPosition.FACEUP },
    ],
    capturar: (message, resposta) =>
      message.type === OcgMessageType.SELECT_IDLECMD && message.activates.length > 0
        ? {
            acao: resposta.action,
            code:
              resposta.action === SelectIdleCMDAction.SELECT_ACTIVATE
                ? message.activates[resposta.index]?.code
                : null,
          }
        : undefined,
  });
  conferir(
    r && r.acao === SelectIdleCMDAction.SELECT_ACTIVATE && r.code === POT_OF_GREED,
    "ativa o Pote da Ganância antes de invocar",
    JSON.stringify(r),
  );
}

{
  // O bot antigo nunca encadeava nada: toda armadilha morria baixada no campo.
  const r = await cenario({
    place: [
      { player: 0, zone: Zone.SZONE, code: MIRROR_FORCE, sequence: 0, position: OcgPosition.FACEDOWN },
      monstro(0, BATTLE_OX, 0, OcgPosition.FACEUP_DEFENSE),
      monstro(1, BLUE_EYES),
    ],
    capturar: (message, resposta) =>
      message.type === OcgMessageType.SELECT_CHAIN &&
      message.selects.some((c) => c.code === MIRROR_FORCE)
        ? resposta.index
        : undefined,
  });
  conferir(r !== null && r !== undefined, "responde ao ataque com a Força do Espelho", String(r));
}

// ── Cenários do bot moderno (Master Rule 2020) ──
const LINK_SPIDER = 98978921; // Link 1, 1000 ATK
const UTOPIA = 84013237; // Xyz Rank 4, 2500 ATK, efeito
const ODD_EYES = 16178681; // Pêndulo, escala 4
const TIMEGAZER = 20409757; // Pêndulo, escala 8
const DARK_MAGICIAN = 46986414; // Nível 7
const ASH_BLOSSOM = 14558127; // hand trap: nega busca/compra do Deck
const REINFORCEMENT = 32807846; // Reforço do Exército: busca um Guerreiro
const CELTIC_GUARDIAN = 91152256; // Guerreiro, Nível 4
const MR5 = OcgDuelMode.MODE_MR5;

const naMain = (message, resposta) =>
  message.type === OcgMessageType.SELECT_IDLECMD
    ? {
        acao: resposta.action,
        code:
          resposta.action === SelectIdleCMDAction.SELECT_SPECIAL_SUMMON
            ? message.special_summons[resposta.index]?.code
            : resposta.action === SelectIdleCMDAction.SELECT_ACTIVATE
              ? message.activates[resposta.index]?.code
              : resposta.action === SelectIdleCMDAction.SELECT_SUMMON
                ? message.summons[resposta.index]?.code
                : null,
      }
    : undefined;

{
  // O bot antigo fazia toda Invocação do Extra Deck que o core oferecesse.
  const r = await cenario({
    mode: MR5,
    place: [monstro(0, BATTLE_OX, 2), { player: 0, zone: Zone.EXTRA, code: LINK_SPIDER }],
    capturar: naMain,
  });
  conferir(
    r && !(r.acao === SelectIdleCMDAction.SELECT_SPECIAL_SUMMON && r.code === LINK_SPIDER),
    "não troca Battle Ox (1700) por Link Spider (Link 1, 1000)",
    JSON.stringify(r),
  );
}

{
  const r = await cenario({
    mode: MR5,
    place: [
      monstro(0, BATTLE_OX, 1),
      monstro(0, BATTLE_OX, 2),
      { player: 0, zone: Zone.EXTRA, code: UTOPIA },
    ],
    capturar: naMain,
  });
  conferir(
    r && r.acao === SelectIdleCMDAction.SELECT_SPECIAL_SUMMON && r.code === UTOPIA,
    "faz Utopia (Xyz 2500, efeito) com dois Battle Ox",
    JSON.stringify(r),
  );
}

{
  // Escalas 4 e 8 abrem os Níveis 5–7: Dark Magician entra pela Invocação-
  // Pêndulo sem gastar a Normal.
  const r = await cenario({
    mode: MR5,
    place: [
      { player: 0, zone: Zone.HAND, code: ODD_EYES },
      { player: 0, zone: Zone.HAND, code: TIMEGAZER },
      { player: 0, zone: Zone.HAND, code: DARK_MAGICIAN },
    ],
    capturar: naMain,
  });
  conferir(
    r && r.acao === SelectIdleCMDAction.SELECT_ACTIVATE && [ODD_EYES, TIMEGAZER].includes(r.code),
    "põe um Pêndulo na escala quando a faixa abre um monstro da mão",
    JSON.stringify(r),
  );
}

{
  const r = await cenario({
    mode: MR5,
    place: [{ player: 0, zone: Zone.HAND, code: ODD_EYES }, { player: 0, zone: Zone.HAND, code: BATTLE_OX }],
    capturar: naMain,
  });
  conferir(
    r && !(r.acao === SelectIdleCMDAction.SELECT_ACTIVATE && r.code === ODD_EYES),
    "não gasta um Pêndulo na escala sem faixa nenhuma para invocar",
    JSON.stringify(r),
  );
}

{
  // A Ash Blossom pega qualquer busca do Deck — inclusive a do próprio bot.
  let ativou = false;
  const r = await cenario({
    mode: MR5,
    // Guerreiros de Nível 4 no Deck: sem alvo o Reforço nem é oferecido.
    deck0: Array.from({ length: 40 }, () => CELTIC_GUARDIAN),
    place: [
      { player: 0, zone: Zone.HAND, code: REINFORCEMENT },
      { player: 0, zone: Zone.HAND, code: ASH_BLOSSOM },
    ],
    forcar: (message) => {
      if (ativou || message.type !== OcgMessageType.SELECT_IDLECMD) return null;
      const index = message.activates.findIndex((c) => c.code === REINFORCEMENT);
      if (index < 0) return null;
      ativou = true;
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index };
    },
    capturar: (message, resposta) =>
      message.type === OcgMessageType.SELECT_CHAIN &&
      message.player === 0 &&
      message.selects.some((c) => c.code === ASH_BLOSSOM)
        ? resposta.index === null ||
          message.selects[resposta.index]?.code !== ASH_BLOSSOM
        : undefined,
  });
  conferir(
    r === true,
    "não encadeia a própria Ash Blossom na própria busca",
    r === undefined ? "o core não ofereceu a Ash (cenário não aconteceu)" : String(r),
  );
}

{
  // Battle Phase sem saída: nem Main 2 nem End Phase oferecidas — um efeito
  // obriga a atacar (visto com o Dark Eradicator Warlock do SD6). O bot pedia
  // End Phase mesmo assim, e o core respondia RETRY até o duelo cair.
  const duel = await createDuel({ decks: [[BATTLE_OX], [BATTLE_OX]], place: [monstro(0, BATTLE_OX), monstro(1, SUMMONED_SKULL)] });
  const prompt = {
    type: OcgMessageType.SELECT_BATTLECMD,
    player: 0,
    chains: [],
    attacks: [{ code: BATTLE_OX, controller: 0, location: Zone.MZONE, sequence: 0, can_direct: false }],
    to_m2: false,
    to_ep: false,
  };
  const ctx = {
    prompt,
    me: 0,
    readBoard: (full) => readBoardState(duel.core, duel.handle, 0, !full),
    cardDb,
    lifePoints: [8000, 8000],
    phase: null,
    turnPlayer: 0,
    turnCount: 3,
  };
  const r = new BotBrain().decide(ctx);
  const reserva = botAutoResponse(prompt);
  duel.destroy();
  conferir(
    r.action === SelectBattleCMDAction.SELECT_BATTLE && reserva.action === SelectBattleCMDAction.SELECT_BATTLE,
    "ataca quando o core não oferece nem Main 2 nem End Phase (bot e reserva)",
    JSON.stringify([r, reserva]),
  );
}

// ── Contra-armadilhas ──
// A nota fixa antiga (30, abaixo do limiar de 45) guardava toda contra-
// armadilha para sempre. Agora ela vale o que nega menos o que cobra; os
// cenários conferem os dois lados da conta e as duas armadilhas da sessão:
// a própria Invocação, e a janela de Invocação que nunca recebe SUMMONED.
const SOLEMN_JUDGMENT = 41420027; // Julgamento Solene: metade dos PV
const SOLEMN_WARNING = 84749824; // Aviso Solene: 2000 PV
const MAGIC_JAMMER = 77414722; // Bloqueador de Magia: descartar 1
const SEVEN_TOOLS = 3819470; // Sete Ferramentas do Bandido: 1000 PV
const SNATCH_STEAL = 45986603; // Roubar
// Deck do bot sem monstro invocável: sem tributo à mão, nada que ele compre
// abre uma janela de Invocação própria antes da do adversário.
const SO_BLUE_EYES = Array.from({ length: 40 }, () => BLUE_EYES);

const baixada = (player, code, sequence = 0) =>
  ({ player, zone: Zone.SZONE, code, sequence, position: OcgPosition.FACEDOWN });
const naMao = (player, code) => ({ player, zone: Zone.HAND, code });

/** O bot (assento 0) encadeou `code` no primeiro SELECT_CHAIN que a ofereceu? */
const encadeia = (code) => (message, resposta) =>
  message.type === OcgMessageType.SELECT_CHAIN &&
  message.player === 0 &&
  message.selects.some((c) => c.code === code)
    ? resposta.index !== null && message.selects[resposta.index]?.code === code
    : undefined;

/** Roteiro do adversário: ativa `code` na primeira chance — Main ou corrente. */
const ativa = (code) => {
  let feito = false;
  return (message) => {
    if (feito) return null;
    if (message.type === OcgMessageType.SELECT_IDLECMD) {
      const index = message.activates.findIndex((c) => c.code === code);
      if (index < 0) return null;
      feito = true;
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index };
    }
    if (message.type === OcgMessageType.SELECT_CHAIN) {
      const index = message.selects.findIndex((c) => c.code === code);
      if (index < 0) return null;
      feito = true;
      return { type: OcgResponseType.SELECT_CHAIN, index };
    }
    return null;
  };
};

{
  const r = await cenario({
    deck0: SO_BLUE_EYES,
    place: [baixada(0, SOLEMN_JUDGMENT), monstro(1, BATTLE_OX), naMao(1, SUMMONED_SKULL)],
    capturar: encadeia(SOLEMN_JUDGMENT),
  });
  conferir(
    r === true,
    "nega com o Julgamento Solene a Invocação-Tributo de Summoned Skull",
    r === undefined ? "o core não ofereceu o Julgamento" : String(r),
  );
}

{
  // Metade dos PV por um Battle Ox de 1700 sem efeito é pagar caro por pouco.
  const r = await cenario({
    deck0: SO_BLUE_EYES,
    place: [baixada(0, SOLEMN_JUDGMENT), naMao(1, BATTLE_OX)],
    capturar: encadeia(SOLEMN_JUDGMENT),
  });
  conferir(
    r === false,
    "guarda o Julgamento Solene quando o adversário Invoca um Battle Ox",
    r === undefined ? "o core não ofereceu o Julgamento" : String(r),
  );
}

{
  // O core oferece a contra aos dois jogadores na janela de Invocação.
  const r = await cenario({
    deck0: SO_BLUE_EYES,
    place: [baixada(0, SOLEMN_JUDGMENT), monstro(0, BATTLE_OX), naMao(0, SUMMONED_SKULL)],
    capturar: encadeia(SOLEMN_JUDGMENT),
  });
  conferir(
    r === false,
    "não nega a própria Invocação com o Julgamento Solene",
    r === undefined ? "o core não ofereceu o Julgamento (cenário não aconteceu)" : String(r),
  );
}

{
  const r = await cenario({
    deck0: SO_BLUE_EYES,
    place: [
      baixada(0, MAGIC_JAMMER),
      monstro(0, SUMMONED_SKULL),
      // O descarte que o Bloqueador cobra.
      naMao(0, BLUE_EYES),
      naMao(1, SNATCH_STEAL),
    ],
    rival: ativa(SNATCH_STEAL),
    capturar: encadeia(MAGIC_JAMMER),
  });
  conferir(
    r === true,
    "nega com o Bloqueador de Magia o Roubar no Summoned Skull",
    r === undefined ? "o core não ofereceu o Bloqueador" : String(r),
  );
}

{
  const r = await cenario({
    deck0: SO_BLUE_EYES,
    place: [
      baixada(0, SEVEN_TOOLS),
      monstro(0, SUMMONED_SKULL),
      baixada(1, MIRROR_FORCE),
      monstro(1, BATTLE_OX),
    ],
    rival: ativa(MIRROR_FORCE),
    capturar: encadeia(SEVEN_TOOLS),
  });
  conferir(
    r === true,
    "nega com as Sete Ferramentas a Força do Espelho do adversário",
    r === undefined ? "o core não ofereceu as Sete Ferramentas" : String(r),
  );
}

{
  // Invocação do Extra Deck abre a mesma janela: o Aviso Solene leva o
  // Utopia e os dois materiais que já foram gastos nele.
  let fez = false;
  const r = await cenario({
    mode: MR5,
    deck0: SO_BLUE_EYES,
    place: [
      baixada(0, SOLEMN_WARNING),
      monstro(1, BATTLE_OX, 1),
      monstro(1, BATTLE_OX, 2),
      { player: 1, zone: Zone.EXTRA, code: UTOPIA },
    ],
    rival: (message) => {
      if (fez || message.type !== OcgMessageType.SELECT_IDLECMD) return null;
      const index = message.special_summons.findIndex((c) => c.code === UTOPIA);
      if (index < 0) return null;
      fez = true;
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SPECIAL_SUMMON, index };
    },
    capturar: encadeia(SOLEMN_WARNING),
  });
  conferir(
    r === true,
    "nega com o Aviso Solene a Invocação-Xyz de Utopia",
    r === undefined ? "o core não ofereceu o Aviso" : String(r),
  );
}

{
  // O primeiro cenário de novo, agora pela DuelSession — o caminho do app.
  // Acima, quem acompanha a Invocação em andamento é o rastreador do harness;
  // no navegador é a sessão (`summoning`), e é ela que precisa entregá-la ao
  // bot. Bot × bot: o B Invoca o Summoned Skull, o A responde.
  const catalog = JSON.parse(readFileSync(join(REPO, ".cache/catalog/catalog.json"), "utf8"));
  const session = createDuelSession();
  let snap = null;
  let negou = false;
  session.subscribe((s) => {
    snap = s;
  });
  session.subscribeEvents((e) => {
    if (e.kind === "activate" && e.code === SOLEMN_JUDGMENT && e.player === 0) negou = true;
  });
  void session.start({
    playerName: "A",
    playerDeck: { main: SO_BLUE_EYES, extra: [], side: [] },
    opponentName: "B",
    opponentDeck: { main: SO_BLUE_EYES, extra: [], side: [] },
    registry: CardRegistry.fromCatalog(catalog),
    assets: nodeAssets,
    pace: 0,
    seats: [
      { kind: "bot", name: "Bot A" },
      { kind: "bot", name: "Bot B" },
    ],
    watchSeat: 0,
    scenario: [
      { player: 0, location: Zone.SZONE, code: SOLEMN_JUDGMENT, position: OcgPosition.FACEDOWN },
      { player: 1, location: Zone.MZONE, code: BATTLE_OX },
      { player: 1, location: Zone.HAND, code: SUMMONED_SKULL },
    ],
  });
  const limite = Date.now() + 60_000;
  while (!negou && Date.now() < limite && (snap?.turnCount ?? 0) < 4 && !snap?.error) {
    await new Promise((r) => setTimeout(r, 20));
  }
  const invocou = snap?.log.some((l) => l.codes?.includes(SUMMONED_SKULL)) ?? false;
  session.surrender(1);
  conferir(
    negou,
    "pela DuelSession: nega com o Julgamento Solene a Invocação de Summoned Skull",
    snap?.error ?? (invocou ? "o Skull entrou e o bot não respondeu" : `o Skull não foi Invocado (turno ${snap?.turnCount})`),
  );
}

console.log("");

const decks = PRESETS.filter(
  (p) =>
    p.main.length >= 40 && p.extra.length >= EXTRA_MINIMO && (!SO_CONTRA || p.main.some(ehContra)),
);
let contrasNovo = 0;
let contrasRival = 0;
let vitoriasNovo = 0;
let vitoriasAntigo = 0;
let empates = 0;
const travados = [];
/** Duelos que bateram o teto de passos com o jogo ainda andando. */
const longos = [];
let turnosTotais = 0;
/** Placar separado por assento — quem começa tem vantagem em Goat. */
const porAssento = [
  { jogos: 0, vitorias: 0 },
  { jogos: 0, vitorias: 0 },
];
/** Placar por deck — um buraco concentrado num deck é heurística, não azar. */
const porDeck = new Map();

console.log(
  `Cérebro novo x ${RIVAL} — ${PARTIDAS} partidas (${FORMATO}), mesmo deck dos dois lados\n`,
);

for (let partida = 0; partida < PARTIDAS; partida += 1) {
  const preset = decks[partida % decks.length];
  // Assento trocado a cada VOLTA completa pelos decks, não a cada partida: com
  // um número par de presets, alternar de um em um prende cada deck ao mesmo
  // assento para sempre — e o teste passaria a medir o deck, não o bot.
  const assentoNovo = Math.floor(partida / decks.length) % 2;
  const seed = BigInt(1000 + partida * 7);

  if (SO_PARTIDAS && !SO_PARTIDAS.has(partida)) continue;
  const { desfecho, winner, turnos, ultima, recentes, contras } = await duelar({
    deck: preset.main,
    extra: preset.extra,
    seed,
    assentoNovo,
  });
  turnosTotais += turnos;
  contrasNovo += contras[0];
  contrasRival += contras[1];

  // O teto de passos do harness (4.000) com o duelo andando de turno em
  // turno é partida longa — deck de muralha contra deck de muralha (SD7 ×
  // SD7 chega a 67 turnos) —, não travamento: no app não há teto, e o fim do
  // deck encerra. Laço de verdade estoura o teto dentro de poucos turnos.
  const longo = desfecho === "MAX_STEPS" && turnos >= 30;
  if (longo) longos.push({ partida, preset: preset.id, turnos });
  else if (desfecho !== "WIN" && desfecho !== "END") {
    travados.push({ partida, preset: preset.id, desfecho, ultima, recentes, turnos });
  }

  const ganhou = winner === assentoNovo;
  if (ganhou) vitoriasNovo += 1;
  else if (winner === null || winner === 2) empates += 1;
  else vitoriasAntigo += 1;

  porAssento[assentoNovo].jogos += 1;
  if (ganhou) porAssento[assentoNovo].vitorias += 1;
  const deck = porDeck.get(preset.id) ?? { jogos: 0, vitorias: 0 };
  deck.jogos += 1;
  if (ganhou) deck.vitorias += 1;
  porDeck.set(preset.id, deck);

  if ((partida + 1) % 10 === 0) {
    process.stdout.write(
      `  ${partida + 1}/${PARTIDAS} — novo ${vitoriasNovo} x ${vitoriasAntigo} ${RIVAL}\n`,
    );
  }
}

const decididas = vitoriasNovo + vitoriasAntigo;
const taxa = decididas > 0 ? (vitoriasNovo / decididas) * 100 : 0;

console.log("\n─── Placar ───");
console.log(`  cérebro novo:       ${vitoriasNovo}`);
console.log(`  ${RIVAL.padEnd(18)}: ${vitoriasAntigo}`);
console.log(`  sem decisão:        ${empates}`);
console.log(`  aproveitamento:     ${taxa.toFixed(1)}%`);
console.log(`  turnos por duelo:   ${(turnosTotais / PARTIDAS).toFixed(1)}`);
console.log(`  contra-armadilhas:  bot ${contrasNovo} · ${RIVAL} ${contrasRival}`);

console.log("\n─── Por assento ───");
porAssento.forEach((a, seat) => {
  const pct = a.jogos ? ((a.vitorias / a.jogos) * 100).toFixed(0) : "—";
  console.log(
    `  assento ${seat}${seat === 0 ? " (começa)" : "         "}: ${a.vitorias}/${a.jogos} (${pct}%)`,
  );
});

const fracos = [...porDeck.entries()]
  .filter(([, d]) => d.jogos >= 2 && d.vitorias / d.jogos < 0.5)
  .sort((a, b) => a[1].vitorias / a[1].jogos - b[1].vitorias / b[1].jogos);
if (fracos.length > 0) {
  console.log("\n─── Decks em que o bot novo vai mal ───");
  for (const [id, d] of fracos) console.log(`  ${id}: ${d.vitorias}/${d.jogos}`);
}

if (longos.length > 0) {
  console.log(
    `\n· ${longos.length} duelo(s) longo(s), cortados pelo teto de passos com o jogo andando: ` +
      longos.map((l) => `${l.preset} (${l.turnos} turnos)`).join(", "),
  );
}
if (travados.length > 0) {
  console.log(`\n✗ ${travados.length} duelo(s) não terminaram:`);
  for (const t of travados.slice(0, 10)) {
    console.log(`    partida ${t.partida} (${t.preset}): ${t.desfecho}, ${t.turnos} turnos`);
    for (const linha of t.recentes ?? []) console.log(`      ${linha.slice(0, 160)}`);
    if (t.ultima) {
      const json = (valor) =>
        JSON.stringify(valor, (_, v) => (typeof v === "bigint" ? `${v}n` : v)).slice(0, 600);
      console.log(`      recusada (${t.ultima.quem}): ${json(t.ultima.message)}`);
      console.log(`      resposta: ${json(t.ultima.resposta)}`);
    }
  }
} else {
  console.log("\n✓ todos os duelos terminaram");
}

// Um bot que joga melhor ganha da versão que não pensa. 50% é moeda.
// Contra outro cérebro (A/B) a régua não é 65%: o placar é a medida, e o
// teste só reprova por duelo travado ou cenário dirigido quebrado.
const passou =
  (RIVAL === "cerebro" || taxa >= 65) && travados.length === 0 && falhasCenario.length === 0;
if (falhasCenario.length > 0) {
  console.log(`\n✗ ${falhasCenario.length} cenário(s) dirigido(s) falharam`);
}
console.log(
  passou
    ? RIVAL === "cerebro"
      ? `\n✓ A/B concluído: ${taxa.toFixed(1)}% para o bot atual`
      : "\n✓ o bot novo é mais forte"
    : "\n✗ FALHOU",
);
process.exit(passou ? 0 : 1);
