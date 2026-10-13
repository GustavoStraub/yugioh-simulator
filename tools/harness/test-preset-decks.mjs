/**
 * Os decks pré-montados: todos valem, e todos jogam.
 *
 * Os ~100 decks TCG são gerados (`npm run build:presets`) a partir das listas
 * da Yugipedia, e gerar é onde os erros se escondem: uma coluna lida errada
 * vira "1 cópia" em vez de 3, uma seção de brinde entra no deck, um set code
 * aponta a carta errada. Nada disso quebra o build — o deck só fica diferente
 * do produto, ou entra no duelo com carta que o engine não sabe jogar.
 *
 * Duas partes:
 *
 * 1. **Validação, sem duelo.** Ids únicos, linha de produto conhecida,
 *    Main 40–60 e Extra ≤ 15, cada carta na zona certa (Fusão/Sincro/Xyz/Link
 *    no Extra e só lá), toda carta com dados oficiais e script (ou Normal). E
 *    a prova cruzada: os 10 decks Goat, montados à mão anos antes, batem carta
 *    a carta com os mesmos produtos gerados da Yugipedia.
 *
 * 2. **Uma partida por deck, bot × bot, regras TCG (MR5).** Cada deck enfrenta
 *    o seguinte da lista, com o cérebro do bot dos dois lados. Passa se o
 *    duelo termina (ou chega ao teto de passos) sem travar, sem laço de RETRY
 *    e sem erro de script. De quebra, todo prompt do assento 0 passa pela
 *    mesma régua do `test:ui` — a tela teria como responder? — porque esses
 *    duelos exercitam prompts modernos (Link, Xyz, Pêndulo) que os decks Goat
 *    nunca mostram.
 *
 * Em massa (Fase 9): `--rodadas N` joga N partidas por deck, cada rodada
 * contra outro adversário e com outra semente; `--fatia i/n` divide as
 * partidas entre processos (rodar n deles em paralelo); `--json arquivo`
 * grava o resumo da fatia para somar depois. Na bateria em massa os DOIS
 * assentos passam pela régua da tela.
 *
 * Uso:
 *   npm run test:presets
 *   npm run test:presets -- --only tcg-sdwd,tcg-l5dd-yusei
 *   npm run test:presets -- --skip-duels
 *   npm run test:presets -- --rodadas 20 --fatia 0/10 --json .cache/bench/massa-0.json
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { OcgCardHintType, OcgDuelMode, OcgMessageType, OcgPlayerHintType } from "@n1xx1/ocgcore-wasm";

import { PRESET_KIND_ORDER } from "@/lib/domain/preset-decks";
import { autoResponseFor } from "@/lib/duel/auto-response";
import { readBoardState } from "@/lib/duel/board-state";
import { BotBrain } from "@/lib/duel/bot/bot-brain";
import { findPromptMessage } from "@/lib/duel/bot-responder";
import { buildPromptPlan } from "@/lib/duel/duel-actions";
import { EngineStringsDb } from "@/lib/duel/engine-strings";
import { OfficialCardDb } from "@/lib/duel/official-card-data";

import { createDuel, Zone } from "./duel.mjs";
import { REPO } from "./env.mjs";
import { planIsActionable } from "./ui-audit.mjs";

const argv = process.argv.slice(2);
const onlyAt = argv.indexOf("--only");
const ONLY = onlyAt >= 0 ? new Set(argv[onlyAt + 1].split(",")) : null;
const SKIP_DUELS = argv.includes("--skip-duels");
const valorDe = (flag) => {
  const at = argv.indexOf(flag);
  return at >= 0 ? argv[at + 1] : null;
};
const RODADAS = Number(valorDe("--rodadas") ?? 1);
const [FATIA, FATIAS] = (valorDe("--fatia") ?? "0/1").split("/").map(Number);
const JSON_OUT = valorDe("--json");
/** Em massa, as linhas por partida só aparecem quando algo falha. */
const MASSA = RODADAS > 1 || FATIAS > 1;

const lerJson = (path) => JSON.parse(readFileSync(join(REPO, path), "utf8"));
const GOAT = lerJson("src/data/preset-decks.json");
const TCG = lerJson("src/data/preset-decks-tcg.json");
const cardDb = new OfficialCardDb(lerJson("src/data/card-db.json"));
const engineStrings = new EngineStringsDb(lerJson("src/data/engine-strings.json"));

/**
 * Avisos de efeito (o "ⓘ" da carta, o aviso do jogador) que o engine mandou e
 * a tela não soube escrever — a sessão os descarta em silêncio, então só uma
 * contagem aqui os denuncia. Chave: o valor da string; valor: quantas vezes.
 */
const avisosSemTexto = new Map();
let avisosVistos = 0;
function conferirAviso(message) {
  const desc =
    message.type === OcgMessageType.CARD_HINT &&
    (message.card_hint === OcgCardHintType.DESC_ADD || message.card_hint === OcgCardHintType.DESC_REMOVE)
      ? message.description
      : message.type === OcgMessageType.PLAYER_HINT &&
          (message.player_hint === OcgPlayerHintType.DESC_ADD || message.player_hint === OcgPlayerHintType.DESC_REMOVE)
        ? message.description
        : null;
  if (desc === null) return;
  avisosVistos += 1;
  // Aviso que nem a reserva ("Efeito de <carta>") consegue escrever.
  if (!engineStrings.hintText(Number(desc), (code) => `#${code}`)) {
    const chave = String(desc);
    avisosSemTexto.set(chave, (avisosSemTexto.get(chave) ?? 0) + 1);
  }
}

/**
 * Mensagens que o binding não conseguiu ler, por tipo. Com o conserto do
 * `postinstall` elas não derrubam mais o lote: o binding avisa no console e
 * segue. A contagem diz QUAIS são — para saber se alguma importa à tela.
 */
const ilegiveis = {};
const avisoOriginal = console.warn;
console.warn = (...args) => {
  const match = /failed to parse a message: (\d+)/.exec(String(args[0]));
  if (match) {
    ilegiveis[match[1]] = (ilegiveis[match[1]] ?? 0) + 1;
    return;
  }
  avisoOriginal(...args);
};

const falhas = [];
function conferir(condicao, descricao, detalhe = "") {
  if (!condicao) falhas.push(`${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  return condicao;
}

/* ------------------------------------------------------------------ */
/* 1. Validação                                                        */
/* ------------------------------------------------------------------ */

const TYPE_NORMAL = 0x10;
const TYPE_PENDULUM = 0x1000000;
const TYPE_TOKEN = 0x4000;
const EXTRA_TYPES = 0x40 | 0x2000 | 0x800000 | 0x4000000; // Fusão, Sincro, Xyz, Link

/** Mesmos lugares onde o app procura o script (`script-source.ts`). */
const temScript = (passcode) =>
  ["official", "", "pre-errata"].some((dir) =>
    existsSync(join(REPO, ".cache/CardScripts", dir, `c${passcode}.lua`)),
  );

console.log("─── Validação ───");
{
  const todos = [...GOAT, ...TCG];
  const ids = new Set();
  for (const preset of todos) {
    conferir(!ids.has(preset.id), `id único: ${preset.id}`);
    ids.add(preset.id);
    conferir(PRESET_KIND_ORDER.includes(preset.kind), `${preset.id}: linha conhecida`, preset.kind);
  }
  conferir(TCG.length >= 100, `pelo menos 100 decks TCG`, `${TCG.length}`);
  conferir(TCG.every((p) => p.format === "tcg"), "todo deck gerado é do formato TCG");

  let cartas = 0;
  for (const preset of TCG) {
    const { id } = preset;
    conferir(preset.main.length >= 40 && preset.main.length <= 60, `${id}: Main 40–60`, `${preset.main.length}`);
    conferir(preset.extra.length <= 15, `${id}: Extra ≤ 15`, `${preset.extra.length}`);
    conferir(preset.side.length === 0, `${id}: sem Side`);
    conferir(/^https:\/\/yugipedia\.com\/wiki\//.test(preset.sourceUrl), `${id}: fonte citada`);

    const copias = new Map();
    for (const [zona, lista] of [["main", preset.main], ["extra", preset.extra]]) {
      for (const passcode of lista) {
        cartas += 1;
        copias.set(passcode, (copias.get(passcode) ?? 0) + 1);
        const dados = cardDb.get(passcode);
        if (!conferir(dados !== null, `${id}: ${passcode} tem dados oficiais`)) continue;
        conferir((dados.type & TYPE_TOKEN) === 0, `${id}: ${passcode} não é ficha`);
        const doExtra = (dados.type & EXTRA_TYPES) !== 0;
        conferir(doExtra === (zona === "extra"), `${id}: ${passcode} na zona certa`, `está no ${zona}`);
        const normal = (dados.type & TYPE_NORMAL) !== 0 && (dados.type & TYPE_PENDULUM) === 0;
        conferir(
          normal || temScript(cardDb.scriptPasscode(passcode)),
          `${id}: ${passcode} tem script`,
        );
      }
    }
    // Produto oficial nunca traz 4 cópias (o L26D foi recolhido na Europa
    // justamente por um erro de fábrica assim).
    for (const [passcode, n] of copias) {
      conferir(n <= 3, `${id}: no máximo 3 cópias`, `${passcode} ×${n}`);
    }
  }
  console.log(`  ${TCG.length} decks TCG, ${cartas} cartas conferidas`);

  // Prova cruzada: o mesmo produto, montado à mão (Goat) e gerado (TCG).
  // As artes podem diferir (Monster Reborn 83764719 × 83764718) — compara-se
  // a carta, não a arte.
  const PARES = {
    "starter-yugi": "tcg-sdy",
    "starter-kaiba": "tcg-sdk",
    "starter-joey": "tcg-sdj",
    "starter-pegasus": "tcg-sdp",
    "starter-yugi-evo": "tcg-sye",
    "starter-kaiba-evo": "tcg-ske",
    "structure-dragons-roar": "tcg-sd1",
    "structure-zombie-madness": "tcg-sd2",
    "structure-blaze": "tcg-sd3",
    "structure-fury": "tcg-sd4",
  };
  const contagem = (lista) => {
    const mapa = new Map();
    for (const passcode of lista) {
      const carta = cardDb.scriptPasscode(passcode);
      mapa.set(carta, (mapa.get(carta) ?? 0) + 1);
    }
    return mapa;
  };
  let iguais = 0;
  for (const [goatId, tcgId] of Object.entries(PARES)) {
    const a = GOAT.find((p) => p.id === goatId);
    const b = TCG.find((p) => p.id === tcgId);
    if (!conferir(a && b, `par ${goatId} ↔ ${tcgId} existe`)) continue;
    const ca = contagem([...a.main, ...a.extra]);
    const cb = contagem([...b.main, ...b.extra]);
    const diferencas = [...new Set([...ca.keys(), ...cb.keys()])].filter(
      (carta) => (ca.get(carta) ?? 0) !== (cb.get(carta) ?? 0),
    );
    if (conferir(diferencas.length === 0, `${goatId} (à mão) = ${tcgId} (Yugipedia)`, diferencas.join(", "))) {
      iguais += 1;
    }
  }
  console.log(`  prova cruzada com os decks Goat: ${iguais}/${Object.keys(PARES).length} idênticos`);
}

/* ------------------------------------------------------------------ */
/* 2. Uma partida por deck                                             */
/* ------------------------------------------------------------------ */

/** Embaralhamento com semente — a partida que falhar se repete igual. */
function embaralhar(cartas, seed) {
  let estado = Number(seed % 4294967296n) >>> 0;
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

/** Turno e fase, lidos das mensagens que o duelo já emitiu (como no `test:bot`). */
function criarRastreador(duel) {
  let cursor = 0;
  let turnPlayer = null;
  let turnCount = 0;
  let phase = null;
  // Quem ativou o último elo da corrente aberta — a mesma informação que a
  // sessão passa ao bot (`snapshot.chain`).
  let chainPlayer = null;
  /** Carta do último elo — diz de QUEM é o prompt que travou. */
  let chainCode = null;
  return () => {
    for (; cursor < duel.messages.length; cursor += 1) {
      const message = duel.messages[cursor];
      conferirAviso(message);
      if (message.type === OcgMessageType.NEW_TURN) {
        turnPlayer = message.player;
        turnCount += 1;
      } else if (message.type === OcgMessageType.NEW_PHASE) {
        phase = message.phase;
      } else if (message.type === OcgMessageType.CHAINING) {
        chainPlayer = message.controller;
        chainCode = message.code;
      } else if (message.type === OcgMessageType.CHAIN_END) {
        chainPlayer = null;
      }
    }
    return { turnPlayer, turnCount, phase, chainPlayer, chainCode };
  };
}

const MESSAGE_NAMES = Object.fromEntries(
  Object.entries(OcgMessageType)
    .filter(([key]) => Number.isNaN(Number(key)))
    .map(([key, value]) => [value, key]),
);

/** A tela teria como responder a este prompt? (a régua do `test:ui`) */
function auditarTela(message, achados) {
  const nome = MESSAGE_NAMES[message.type] ?? `TYPE_${message.type}`;
  if (!findPromptMessage([message])) return achados.push(`NAO_RECONHECIDO ${nome}`);
  if (autoResponseFor(message)) return;
  let plan;
  try {
    plan = buildPromptPlan(message);
  } catch (error) {
    return achados.push(`PLANO_ESTOUROU ${nome}: ${error?.message ?? error}`);
  }
  if (!planIsActionable(plan)) achados.push(`PLANO_VAZIO ${nome}`);
}

async function partida(a, b, seed) {
  const extra = (player, lista) => lista.map((code) => ({ player, zone: Zone.EXTRA, code }));
  const duel = await createDuel({
    mode: OcgDuelMode.MODE_MR5,
    decks: [embaralhar(a.main, seed), embaralhar(b.main, seed * 31n + 7n)],
    place: [...extra(0, a.extra), ...extra(1, b.extra)],
    seed,
    startingDraw: 5,
  });
  const rastrear = criarRastreador(duel);
  const cerebros = [new BotBrain(), new BotBrain()];
  const achados = [];
  const tipos = new Set();

  // As últimas respostas, para o relatório de um RETRY_LOOP dizer O QUE o
  // core recusou — sem isso a falha é só "travou".
  const ultimas = [];
  const desfecho = duel.run((message) => {
    const resposta = responder(message);
    ultimas.push({ message, resposta });
    if (ultimas.length > 4) ultimas.shift();
    return resposta;
  });

  function responder(message) {
    const seat = "player" in message && message.player === 1 ? 1 : 0;
    if (seat === 0 || MASSA) {
      tipos.add(message.type);
      auditarTela(message, achados);
    }
    const automatico = autoResponseFor(message);
    if (automatico) return automatico;
    const { turnPlayer, turnCount, phase, chainPlayer } = rastrear();
    const cache = new Map();
    return cerebros[seat].decide({
      prompt: message,
      me: seat,
      readBoard: (full) => {
        if (!cache.has(full)) cache.set(full, readBoardState(duel.core, duel.handle, seat, !full));
        return cache.get(full);
      },
      cardDb,
      lifePoints: duel.lifePoints,
      phase,
      turnPlayer,
      turnCount,
      chainPlayer,
    });
  }

  const resultado = {
    desfecho,
    turnos: rastrear().turnCount,
    passos: duel.steps,
    erros: [...new Set(duel.errors)],
    achados: [...new Set(achados)],
    tipos,
    naoRespondidos: duel.unanswered ?? [],
    ultimas: desfecho === "RETRY_LOOP" ? ultimas : [],
    eloAtivo: rastrear().chainCode,
    retries: duel.retriesTotal,
    eof: duel.bindingErrorsTotal,
  };
  duel.destroy();
  return resultado;
}

if (!SKIP_DUELS) {
  console.log(
    MASSA
      ? `\n─── Bot × bot em massa (MR5): ${RODADAS} rodada(s), fatia ${FATIA}/${FATIAS} ───`
      : "\n─── Uma partida por deck (bot × bot, MR5) ───",
  );
  const decks = ONLY ? TCG.filter((p) => ONLY.has(p.id)) : TCG;
  const desfechos = {};
  const tiposVistos = new Set();
  const OK = new Set(["WIN", "END", "MAX_STEPS"]);
  const resumo = { partidas: 0, retries: 0, eof: 0, longas: 0, falhas: [] };

  // Todas as partidas (rodada × deck), na mesma ordem em todo processo — a
  // fatia pega uma a cada `FATIAS`.
  const fila = [];
  for (let rodada = 0; rodada < RODADAS; rodada += 1) {
    for (const a of decks) fila.push({ rodada, a });
  }

  for (const [n, { rodada, a }] of fila.entries()) {
    if (n % FATIAS !== FATIA) continue;
    const i = TCG.indexOf(a);
    // Rodada 0: o adversário é o próximo da lista TCG inteira (não só do
    // filtro), para `--only` repetir exatamente a partida da bateria
    // completa. Cada rodada seguinte anda 7 decks e troca a semente.
    const b = TCG[(i + 1 + rodada * 7) % TCG.length];
    const seed = BigInt(7000 + i * 13 + rodada * 100003);
    let r;
    try {
      r = await partida(a, b, seed);
    } catch (error) {
      conferir(false, `${a.id}: o duelo não começou`, String(error?.message ?? error));
      continue;
    }
    resumo.partidas += 1;
    resumo.retries += r.retries;
    resumo.eof += r.eof;
    desfechos[r.desfecho] = (desfechos[r.desfecho] ?? 0) + 1;
    for (const tipo of r.tipos) tiposVistos.add(tipo);

    // Teto de passos com poucos turnos é laço, não partida longa.
    const travou = !OK.has(r.desfecho) || (r.desfecho === "MAX_STEPS" && r.turnos < 30);
    if (r.desfecho === "MAX_STEPS" && !travou) resumo.longas += 1;
    const bom = !travou && !r.erros.length && !r.achados.length;
    const linha = `${a.id} × ${b.id} (rodada ${rodada}, semente ${seed}): ${r.desfecho}, ${r.turnos} turnos, ${r.passos} passos`;
    if (!MASSA || !bom) console.log(`  ${bom ? "✓" : "✗"} ${linha}`);
    if (!bom) resumo.falhas.push(linha);
    conferir(
      !travou,
      `${a.id} × ${b.id} (rodada ${rodada}): duelo sem travar`,
      `${r.desfecho}${r.naoRespondidos.length ? ` (${r.naoRespondidos.map((t) => MESSAGE_NAMES[t] ?? t).join(", ")})` : ""}`,
    );
    for (const { message, resposta } of r.ultimas.slice(-1)) {
      const json = (valor) => JSON.stringify(valor, (_, v) => (typeof v === "bigint" ? `${v}n` : v));
      console.log(`      recusado: ${MESSAGE_NAMES[message.type]} ${json(message)}`);
      console.log(`      último elo da corrente: ${r.eloAtivo ?? "nenhum"}`);
      console.log(`      resposta: ${json(resposta)}`);
    }
    conferir(r.erros.length === 0, `${a.id} × ${b.id} (rodada ${rodada}): sem erro de script`, r.erros.slice(0, 3).join(" | "));
    conferir(r.achados.length === 0, `${a.id} × ${b.id} (rodada ${rodada}): todo prompt tem resposta na tela`, r.achados.join(", "));
  }

  console.log(`\n  partidas: ${resumo.partidas} | desfechos: ${Object.entries(desfechos).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`  RETRY recuperados: ${resumo.retries} | eof do binding recuperados: ${resumo.eof} | longas (teto de passos, jogo andando): ${resumo.longas}`);
  const nomesIlegiveis = Object.entries(ilegiveis).map(([tipo, n]) => `${MESSAGE_NAMES[tipo] ?? tipo} ×${n}`);
  console.log(`  mensagens que o binding não leu (descartadas uma a uma): ${nomesIlegiveis.join(", ") || "nenhuma"}`);
  // Os avisos só são lidos pelo rastreador, que roda a cada decisão do bot —
  // a passada final pega o que veio depois da última.
  const semTexto = [...avisosSemTexto].map(([desc, n]) => {
    const valor = Number(desc);
    return `${desc} (carta ${Math.floor(valor / 0x100000)}, str${(valor % 0x100000) + 1}) ×${n}`;
  });
  console.log(`  avisos de efeito: ${avisosVistos} vistos | sem texto na tela: ${semTexto.length ? semTexto.join(", ") : "nenhum"}`);
  console.log(
    `  prompts vistos${MASSA ? "" : " no assento 0"} (${tiposVistos.size}): ${[...tiposVistos]
      .map((t) => MESSAGE_NAMES[t] ?? t)
      .sort()
      .join(", ")}`,
  );
  if (JSON_OUT) {
    writeFileSync(
      JSON_OUT,
      JSON.stringify({ ...resumo, ilegiveis, avisosVistos, avisosSemTexto: Object.fromEntries(avisosSemTexto), desfechos, tipos: [...tiposVistos].map((t) => MESSAGE_NAMES[t] ?? t), falhasConferidas: falhas }, null, 1),
    );
  }
}

if (falhas.length) {
  console.log(`\n${falhas.length} falha(s):`);
  for (const falha of falhas.slice(0, 80)) console.log(`  - ${falha}`);
  process.exitCode = 1;
} else {
  console.log("\nDecks pré-montados: tudo certo.");
}
