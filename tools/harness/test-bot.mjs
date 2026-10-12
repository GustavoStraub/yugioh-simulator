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
 * Uso: node --import ./tools/harness/ts-loader-register.mjs tools/harness/test-bot.mjs [partidas] [passivo|guloso]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  OcgMessageType,
  OcgPosition,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
} from "@n1xx1/ocgcore-wasm";

import { autoResponseFor } from "@/lib/duel/auto-response.ts";
import { botAutoResponse } from "@/lib/duel/bot-responder.ts";
import { BotBrain } from "@/lib/duel/bot/bot-brain.ts";
import { readBoardState } from "@/lib/duel/board-state.ts";
import { OfficialCardDb } from "@/lib/duel/official-card-data.ts";

import { autoPilot, createDuel, STOP, Zone } from "./duel.mjs";
import { REPO } from "./env.mjs";

const PARTIDAS = Number(process.argv[2] ?? 60);
const RIVAL = process.argv[3] ?? "passivo";
const responderRival =
  RIVAL === "guloso"
    ? (message) => autoPilot(message, { play: true })
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
  readFileSync(join(REPO, "src/data/preset-decks.json"), "utf8"),
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
  return () => {
    for (; cursor < duel.messages.length; cursor += 1) {
      const message = duel.messages[cursor];
      if (message.type === OcgMessageType.NEW_TURN) {
        turnPlayer = message.player;
        turnCount += 1;
      } else if (message.type === OcgMessageType.NEW_PHASE) {
        phase = message.phase;
      }
    }
    return { turnPlayer, turnCount, phase };
  };
}

/** Roda um duelo; devolve o vencedor e como o duelo terminou. */
async function duelar({ deck, seed, assentoNovo }) {
  const duel = await createDuel({
    // Baralhos embaralhados **em separado**: com a mesma ordem dos dois lados o
    // duelo vira espelho e o placar mede a simetria, não a decisão.
    decks: [embaralhar(deck, seed), embaralhar(deck, seed * 31n + 7n)],
    seed,
    startingDraw: 5,
  });
  const rastrear = criarRastreador(duel);
  const brain = new BotBrain();

  const politica = (message) => {
    // Mesmo caminho do app: o que não tem escolha real se responde sozinho.
    const automatico = autoResponseFor(message);
    if (automatico) return automatico;

    const seat = "player" in message && message.player === 1 ? 1 : 0;
    if (seat !== assentoNovo) return responderRival(message);

    const { turnPlayer, turnCount, phase } = rastrear();
    const cache = new Map();
    return brain.decide({
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
    });
  };

  const desfecho = duel.run(politica, { play: false });
  const resultado = {
    desfecho,
    winner: duel.winner,
    turnos: rastrear().turnCount,
    lp: [...duel.lifePoints],
  };
  duel.destroy();
  return resultado;
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
async function cenario({ place, capturar }) {
  const deck = Array.from({ length: 40 }, () => BATTLE_OX);
  const duel = await createDuel({
    decks: [deck, deck],
    seed: 9n,
    startingDraw: 0,
    place,
  });
  const brain = new BotBrain();
  let capturado;

  duel.run((message) => {
    const automatico = autoResponseFor(message);
    if (automatico) return automatico;
    const seat = "player" in message && message.player === 1 ? 1 : 0;
    if (seat !== 0) return botAutoResponse(message);

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
      phase: null,
      turnPlayer: 0,
      turnCount: 1,
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

console.log("");

const decks = PRESETS.filter((p) => p.main.length >= 40);
let vitoriasNovo = 0;
let vitoriasAntigo = 0;
let empates = 0;
const travados = [];
let turnosTotais = 0;
/** Placar separado por assento — quem começa tem vantagem em Goat. */
const porAssento = [
  { jogos: 0, vitorias: 0 },
  { jogos: 0, vitorias: 0 },
];
/** Placar por deck — um buraco concentrado num deck é heurística, não azar. */
const porDeck = new Map();

console.log(
  `Cérebro novo x ${RIVAL} — ${PARTIDAS} partidas, mesmo deck dos dois lados\n`,
);

for (let partida = 0; partida < PARTIDAS; partida += 1) {
  const preset = decks[partida % decks.length];
  // Assento trocado a cada VOLTA completa pelos decks, não a cada partida: com
  // um número par de presets, alternar de um em um prende cada deck ao mesmo
  // assento para sempre — e o teste passaria a medir o deck, não o bot.
  const assentoNovo = Math.floor(partida / decks.length) % 2;
  const seed = BigInt(1000 + partida * 7);

  const { desfecho, winner, turnos } = await duelar({
    deck: preset.main,
    seed,
    assentoNovo,
  });
  turnosTotais += turnos;

  if (desfecho !== "WIN" && desfecho !== "END") {
    travados.push({ partida, preset: preset.id, desfecho });
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

if (travados.length > 0) {
  console.log(`\n✗ ${travados.length} duelo(s) não terminaram:`);
  for (const t of travados.slice(0, 10)) {
    console.log(`    partida ${t.partida} (${t.preset}): ${t.desfecho}`);
  }
} else {
  console.log("\n✓ todos os duelos terminaram");
}

// Um bot que joga melhor ganha da versão que não pensa. 50% é moeda.
const passou = taxa >= 65 && travados.length === 0 && falhasCenario.length === 0;
if (falhasCenario.length > 0) {
  console.log(`\n✗ ${falhasCenario.length} cenário(s) dirigido(s) falharam`);
}
console.log(passou ? "\n✓ o bot novo é mais forte" : "\n✗ FALHOU");
process.exit(passou ? 0 : 1);
