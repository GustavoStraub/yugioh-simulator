/**
 * Marcas das cartas: o que o engine anuncia aparece na mesa, nas duas óticas?
 *
 * O engine sabe de muita coisa que fica "marcada" numa carta ou num jogador e
 * que a tela descartava: o Marcador de Magia do Breaker, os turnos das Espadas da
 * Luz Reveladora, a carta que a Proibição declarou, a quem um Equipamento está
 * ligado, o monstro que o Chamado do Assombrado trouxe, o aviso que um efeito
 * escreve na carta, a carta negada pelo Skill Drain, o "não pode Invocar" de
 * um jogador e as zonas que o Desmoronamento interditou.
 *
 * Roda a `DuelSession` de verdade com os DOIS assentos olhando (como num duelo
 * online), confere cada marca no tabuleiro de cada ótica e confere a projeção
 * por assento (`projectSnapshot`) — que é exatamente o que um jogador recebe
 * ao reconectar.
 *
 * Uso: npm run test:marks
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgResponseType,
  SelectIdleCMDAction,
  ocgPositionParse,
} from "@n1xx1/ocgcore-wasm";

import { botAutoResponse } from "@/lib/duel/bot-responder";
import { createDuelSession } from "@/lib/duel/duel-session";
import { decodeFieldMask } from "@/lib/duel/field-places";
import { CardRegistry } from "@/lib/domain/card-registry";
import { projectSnapshot } from "@/server/duel/room";
import { nodeAssets } from "@/server/duel/node-assets";

import { EngineStringsDb } from "@/lib/duel/engine-strings";

import { REPO, SCRIPTS_DIR } from "./env.mjs";

const C = {
  ox: 5053103,
  elf: 15025844,
  breaker: 71413901,
  swords: 72302403,
  prohibition: 43711255,
  callOfTheHaunted: 97077563,
  axe: 40619825,
  skillDrain: 82732705,
  strayLambs: 60764581,
  groundCollapse: 90502999,
  lance: 27243130,
  clockTower: 75041269,
};

const catalog = JSON.parse(readFileSync(join(REPO, ".cache/catalog/catalog.json"), "utf8"));
const registry = CardRegistry.fromCatalog(catalog);

const falhas = [];
function conferir(condicao, descricao, detalhe = "") {
  if (condicao) {
    console.log(`  ✓ ${descricao}`);
  } else {
    falhas.push(descricao);
    console.log(`  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const M = OcgLocation.MZONE;
const S = OcgLocation.SZONE;

/**
 * Joga uma sessão com o assento 0 seguindo um roteiro de jogadas e o 1
 * recusando tudo. Para quando o roteiro acaba (o próximo SELECT_IDLECMD do
 * assento 0) ou quando `pararSe` diz que basta.
 *
 * @param jogadas lista de `{ acao: "summon"|"activate", code, alvo?, fimDeTurno? }`.
 */
async function jogar({ scenario, jogadas, pararSe = () => false, antesDaJogada = {} }) {
  const session = createDuelSession();
  let snap = null;
  session.subscribe((s) => {
    snap = s;
  });
  void session.start({
    playerName: "Ana",
    playerDeck: { main: Array(40).fill(C.ox), extra: [], side: [] },
    opponentName: "Bruno",
    opponentDeck: { main: Array(40).fill(C.ox), extra: [], side: [] },
    registry,
    assets: nodeAssets,
    format: "tcg",
    scenario,
    seats: [
      { kind: "local", name: "Ana" },
      { kind: "local", name: "Bruno" },
    ],
  });

  let passo = 0;
  let alvoAtual = null;
  const limite = Date.now() + 120_000;
  while (Date.now() < limite) {
    await sleep(5);
    if (!snap) continue;
    if (snap.error) throw new Error(`sessão falhou: ${snap.error}`);
    if (pararSe(snap)) break;
    const prompt = snap.pendingPrompt;
    if (!prompt || snap.isProcessing) continue;

    if (snap.promptPlayer === 1) {
      const resposta =
        prompt.type === OcgMessageType.SELECT_CHAIN && !prompt.forced
          ? { type: OcgResponseType.SELECT_CHAIN, index: null }
          : prompt.type === OcgMessageType.SELECT_IDLECMD
            ? { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null }
            : botAutoResponse(prompt);
      await session.respond(resposta, snap.promptId);
      continue;
    }

    let resposta = null;
    switch (prompt.type) {
      case OcgMessageType.SELECT_IDLECMD: {
        // Fotografia do tabuleiro antes da jogada `passo` (as anteriores já
        // resolveram) — para conferir uma marca que a jogada seguinte muda.
        antesDaJogada[passo]?.(snap);
        delete antesDaJogada[passo];
        const jogada = jogadas[passo];
        if (!jogada) return { session, snap };
        if (jogada.acao === "fim") {
          passo += 1;
          resposta = { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null };
          break;
        }
        const lista = jogada.acao === "summon" ? prompt.summons : prompt.activates;
        const index = lista.findIndex((c) => c.code === jogada.code);
        if (index < 0) {
          falhas.push(`jogada não oferecida: ${jogada.acao} ${jogada.code}`);
          return { session, snap };
        }
        passo += 1;
        alvoAtual = jogada.alvo ?? null;
        resposta = {
          type: OcgResponseType.SELECT_IDLECMD,
          action:
            jogada.acao === "summon"
              ? SelectIdleCMDAction.SELECT_SUMMON
              : SelectIdleCMDAction.SELECT_ACTIVATE,
          index,
        };
        break;
      }
      case OcgMessageType.SELECT_CARD: {
        const index = alvoAtual ? prompt.selects.findIndex((c) => c.code === alvoAtual) : -1;
        resposta = { type: OcgResponseType.SELECT_CARD, indicies: [Math.max(index, 0)] };
        break;
      }
      case OcgMessageType.SELECT_CHAIN:
        resposta = { type: OcgResponseType.SELECT_CHAIN, index: prompt.forced ? 0 : null };
        break;
      case OcgMessageType.ANNOUNCE_CARD:
        resposta = { type: OcgResponseType.ANNOUNCE_CARD, card: C.ox };
        break;
      case OcgMessageType.SELECT_PLACE:
      case OcgMessageType.SELECT_DISFIELD: {
        const lugares = decodeFieldMask(prompt.field_mask, prompt.player);
        // Zonas de MONSTRO livres para o Desmoronamento; para Magia, a 1ª livre.
        resposta = {
          type: prompt.type === OcgMessageType.SELECT_PLACE ? OcgResponseType.SELECT_PLACE : OcgResponseType.SELECT_DISFIELD,
          places: lugares.slice(0, prompt.count),
        };
        break;
      }
      case OcgMessageType.SELECT_POSITION: {
        const ok = ocgPositionParse(prompt.positions);
        resposta = {
          type: OcgResponseType.SELECT_POSITION,
          position: ok.includes(OcgPosition.FACEUP_ATTACK) ? OcgPosition.FACEUP_ATTACK : ok[0],
        };
        break;
      }
      default:
        resposta = botAutoResponse(prompt);
    }
    await session.respond(resposta, snap.promptId);
  }
  return { session, snap };
}

/**
 * Invariante de informação oculta: carta que quem olha não vê (código `null`)
 * não carrega marca nenhuma — um contador ou um "declarado" num monstro
 * baixado diria qual monstro ele é. Nem número: o core responde o ATK/DEF de
 * um monstro baixado, e online o tabuleiro vai inteiro pelo WebSocket.
 */
function marcasEmCartaOculta(snap) {
  const problemas = [];
  for (const quem of [0, 1]) {
    for (const lado of snap.boards[quem]?.players ?? []) {
      for (const carta of [...lado.monsters, ...lado.spells, lado.field, ...lado.banished]) {
        if (!carta || carta.code !== null) continue;
        const numeros = [carta.attack, carta.defenseValue, carta.baseAttack, carta.baseDefense];
        if (
          carta.counters.length || carta.hints.length || carta.targets.length || carta.equippedTo || carta.negated ||
          numeros.some((n) => n !== null)
        ) {
          problemas.push(`${quem}: ${carta.controller}:${carta.location}:${carta.sequence}`);
        }
      }
    }
  }
  return problemas;
}

/** A carta de `code` no campo de `dono`, na ótica de `quem`. */
function naMesa(snap, quem, dono, code) {
  const lado = snap.boards[quem]?.players[dono];
  if (!lado) return null;
  return [...lado.monsters, ...lado.spells, lado.field].find((c) => c?.code === code) ?? null;
}

// ---------------------------------------------------------------------------
console.log("Marcas no campo — contador, declaração, alvo, equipamento, aviso, negação");
{
  /** O tabuleiro logo antes do Skill Drain (jogada 5). */
  let antesDoDrain = null;
  const { snap } = await jogar({
    antesDaJogada: { 5: (s) => (antesDoDrain = s) },
    scenario: [
      { player: 0, location: OcgLocation.HAND, code: C.breaker },
      { player: 0, location: OcgLocation.HAND, code: C.prohibition },
      { player: 0, location: OcgLocation.HAND, code: C.axe },
      { player: 0, location: OcgLocation.HAND, code: C.lance },
      { player: 0, location: S, sequence: 1, code: C.callOfTheHaunted },
      { player: 0, location: S, sequence: 2, code: C.skillDrain },
      { player: 0, location: OcgLocation.GRAVE, code: C.elf },
      { player: 1, location: M, sequence: 2, code: C.ox },
    ],
    jogadas: [
      { acao: "summon", code: C.breaker },
      { acao: "activate", code: C.prohibition },
      { acao: "activate", code: C.callOfTheHaunted, alvo: C.elf },
      { acao: "activate", code: C.axe, alvo: C.elf },
      { acao: "activate", code: C.lance, alvo: C.ox },
      { acao: "activate", code: C.skillDrain },
    ],
  });

  for (const quem of [0, 1]) {
    const otica = quem === 0 ? "dona" : "oponente";
    const antes = naMesa(antesDoDrain, quem, 0, C.breaker);
    conferir(
      antes?.counters.some((c) => c.type === 0x1 && c.count === 1) && !antes.negated,
      `[${otica}] o Breaker tem 1 Marcador de Magia`,
      JSON.stringify(antes?.counters),
    );
    const breaker = naMesa(snap, quem, 0, C.breaker);
    conferir(breaker?.negated === true, `[${otica}] o Breaker aparece negado pelo Skill Drain`);
    // Regra do core: contador que não é "permanente" sai quando os efeitos da
    // carta são negados — e a mesa tem que acompanhar.
    conferir(
      breaker?.counters.length === 0,
      `[${otica}] e o Marcador de Magia some com a negação`,
      JSON.stringify(breaker?.counters),
    );
    const proibicao = naMesa(snap, quem, 0, C.prohibition);
    conferir(
      proibicao?.hints.some((h) => h.kind === "card" && h.code === C.ox),
      `[${otica}] a Proibição mostra a carta declarada`,
      JSON.stringify(proibicao?.hints),
    );
    const chamado = naMesa(snap, quem, 0, C.callOfTheHaunted);
    const elf = naMesa(snap, quem, 0, C.elf);
    conferir(
      chamado?.targets.some((t) => t.location === M && t.sequence === elf?.sequence),
      `[${otica}] o Chamado do Assombrado aponta o monstro que trouxe`,
      JSON.stringify(chamado?.targets),
    );
    const machado = naMesa(snap, quem, 0, C.axe);
    conferir(
      machado?.equippedTo?.location === M && machado.equippedTo.sequence === elf?.sequence,
      `[${otica}] o Machado do Desespero diz a quem está equipado`,
      JSON.stringify(machado?.equippedTo),
    );
    // O core responde ATK/DEF 0 para Magia/Armadilha, e a mesa pintava "0/0".
    const comNumero = snap.boards[quem].players[0].spells.filter(
      (c) => c && (c.attack !== null || c.defenseValue !== null),
    );
    conferir(
      comNumero.length === 0,
      `[${otica}] nenhuma Magia/Armadilha da fileira carrega ATK/DEF`,
      JSON.stringify(comNumero.map((c) => [c.code, c.attack, c.defenseValue])),
    );
    const boi = naMesa(snap, quem, 1, C.ox);
    conferir(
      boi?.hints.some((h) => h.kind === "desc" && /Magia\/Armadilha/.test(h.text)),
      `[${otica}] a Lança Proibida escreve o aviso no Touro do oponente`,
      JSON.stringify(boi?.hints),
    );
  }

  // O que o jogador recebe ao (re)conectar é a projeção do assento.
  for (const assento of [0, 1]) {
    const projetado = projectSnapshot(snap, assento);
    const breaker = naMesa(projetado, assento, 0, C.breaker);
    const proibicao = naMesa(projetado, assento, 0, C.prohibition);
    const machado = naMesa(projetado, assento, 0, C.axe);
    conferir(
      breaker?.negated && proibicao?.hints.length > 0 && machado?.equippedTo,
      `a projeção do assento ${assento} (o que chega ao reconectar) leva as marcas`,
    );
  }
  conferir(/perdeu 1 Marcador de Magia/.test(snap.log.map((l) => l.text).join("\n")), "o log narra o contador saindo");
  const ocultas = [...marcasEmCartaOculta(antesDoDrain), ...marcasEmCartaOculta(snap)];
  conferir(ocultas.length === 0, "nenhuma carta oculta carrega marca, em nenhuma ótica", ocultas.join(", "));
  const log = snap.log.map((l) => l.text).join("\n");
  conferir(/Breaker.*recebeu 1 Marcador de Magia/.test(log), "o log narra o Marcador de Magia", "");
  conferir(/foi equipada a/.test(log), "o log narra o equipamento");
}

// ---------------------------------------------------------------------------
console.log("\nMarcas de turno, de jogador e de zona");
{
  let lambsVisto = null;
  let zonasVistas = 0;
  const { snap } = await jogar({
    scenario: [
      { player: 0, location: OcgLocation.HAND, code: C.swords },
      { player: 0, location: OcgLocation.HAND, code: C.strayLambs },
      { player: 0, location: OcgLocation.HAND, code: C.groundCollapse },
    ],
    jogadas: [
      { acao: "activate", code: C.swords },
      { acao: "activate", code: C.strayLambs },
      { acao: "activate", code: C.groundCollapse },
      { acao: "fim" },
    ],
    pararSe: (s) => {
      if (s.playerHints[0].length > 0) lambsVisto ??= [...s.playerHints[0]];
      if (s.disabledZones) zonasVistas = s.disabledZones;
      // Espadas: o contador sobe no fim do turno do oponente — basta chegar ao
      // meu segundo turno.
      return s.turnCount >= 3 && s.pendingPrompt?.type === OcgMessageType.SELECT_IDLECMD && s.promptPlayer === 0;
    },
  });

  conferir(
    lambsVisto?.some((h) => /summon|invoc/i.test(h)),
    "o aviso de jogador das Ovelhas Perdidas apareceu junto do assento 0",
    JSON.stringify(lambsVisto),
  );
  const bits = [...Array(32).keys()].filter((b) => (zonasVistas >>> b) & 1);
  conferir(bits.length === 2, "o Desmoronamento interditou 2 zonas", JSON.stringify(bits));
  for (const quem of [0, 1]) {
    const espadas = naMesa(snap, quem, 0, C.swords);
    conferir(
      espadas?.hints.some((h) => h.kind === "turn" && h.value >= 1),
      `[${quem === 0 ? "dona" : "oponente"}] as Espadas mostram a contagem de turnos`,
      JSON.stringify(espadas?.hints),
    );
  }
}

// ---------------------------------------------------------------------------
console.log("\nContador cujo tipo não é 1: Clock Tower Prison");
{
  const { snap } = await jogar({
    scenario: [{ player: 0, location: OcgLocation.HAND, code: C.clockTower }],
    jogadas: [{ acao: "activate", code: C.clockTower }, { acao: "fim" }],
    // O Marcador de Relógio entra na Standby do oponente — basta chegar ao
    // meu segundo turno.
    pararSe: (s) =>
      s.turnCount >= 3 && s.pendingPrompt?.type === OcgMessageType.SELECT_IDLECMD && s.promptPlayer === 0,
  });
  for (const quem of [0, 1]) {
    const torre = naMesa(snap, quem, 0, C.clockTower);
    conferir(
      torre?.counters.length === 1 && torre.counters[0].type === 0x1b && torre.counters[0].count === 1,
      `[${quem === 0 ? "dona" : "oponente"}] a Torre mostra 1 Marcador de Relógio (tipo 0x1b), não 27`,
      JSON.stringify(torre?.counters),
    );
    conferir(
      torre?.attack === null && torre?.defenseValue === null,
      `[${quem === 0 ? "dona" : "oponente"}] Magia de Campo não carrega ATK/DEF (o "0/0" da mesa)`,
      JSON.stringify({ atk: torre?.attack, def: torre?.defenseValue }),
    );
  }
  conferir(
    /recebeu 1 Marcador de Relógio/.test(snap.log.map((l) => l.text).join("\n")),
    "o log narra o Marcador de Relógio",
  );
}

// ---------------------------------------------------------------------------
console.log("\nCarta oculta não leva ATK/DEF: monstro baixado e banida virada");
{
  const { snap } = await jogar({
    scenario: [
      { player: 1, location: M, sequence: 2, position: OcgPosition.FACEDOWN_DEFENSE, code: C.ox },
      { player: 1, location: OcgLocation.REMOVED, position: OcgPosition.FACEDOWN, code: C.elf },
      { player: 0, location: M, sequence: 1, position: OcgPosition.FACEDOWN_DEFENSE, code: C.elf },
    ],
    jogadas: [],
  });
  const projecoes = [0, 1].map((assento) => projectSnapshot(snap, assento));
  const ocultas = [snap, ...projecoes].flatMap(marcasEmCartaOculta);
  conferir(ocultas.length === 0, "nenhuma carta oculta carrega ATK/DEF, em nenhuma ótica nem projeção", ocultas.join(", "));

  const baixadoDele = snap.boards[0].players[1].monsters[2];
  conferir(
    baixadoDele?.faceDown && baixadoDele.code === null && baixadoDele.attack === null && baixadoDele.defenseValue === null,
    "o monstro baixado do oponente chega sem código e sem ATK/DEF",
    JSON.stringify(baixadoDele && [baixadoDele.code, baixadoDele.attack, baixadoDele.defenseValue]),
  );
  const banidaDele = snap.boards[0].players[1].banished[0];
  conferir(
    banidaDele?.faceDown && banidaDele.code === null && banidaDele.attack === null,
    "a banida virada do oponente chega sem código e sem ATK",
    JSON.stringify(banidaDele && [banidaDele.code, banidaDele.attack]),
  );
  // O outro lado da moeda: o dono continua vendo os números da própria carta.
  const meuBaixado = snap.boards[0].players[0].monsters[1];
  conferir(
    meuBaixado?.code === C.elf && meuBaixado.attack === 800 && meuBaixado.defenseValue === 2000,
    "o dono vê o ATK/DEF do próprio monstro baixado",
    JSON.stringify(meuBaixado && [meuBaixado.code, meuBaixado.attack, meuBaixado.defenseValue]),
  );
  const doDono = snap.boards[1].players[1].monsters[2];
  conferir(
    doDono?.code === C.ox && doDono.attack === 1700,
    "e o oponente vê o do dele, na própria ótica",
    JSON.stringify(doDono && [doDono.code, doDono.attack]),
  );
}

// ---------------------------------------------------------------------------
// Todo contador que algum script usa tem nome na tela?
// ---------------------------------------------------------------------------
// Varre os scripts atrás dos tipos de contador (número direto ou constante
// COUNTER_*) e confere que cada um vira um nome — e não o "Marcador" genérico
// de quando o `strings.conf` não o conhece (caso do E.C. Counter dos
// Enneacraft, que o upstream não nomeia).
console.log("\nCobertura: todo tipo de contador dos scripts tem nome");
{
  const strings = new EngineStringsDb(
    JSON.parse(readFileSync(join(REPO, "src/data/engine-strings.json"), "utf8")),
  );
  const constantes = Object.fromEntries(
    [...readFileSync(join(SCRIPTS_DIR, "card_counter_constants.lua"), "utf8").matchAll(
      /^\s*(COUNTER_[A-Z0-9_]+)\s*=\s*(0x[0-9a-fA-F]+|\d+)/gm,
    )].map((m) => [m[1], Number(m[2])]),
  );
  const uso =
    /(?:AddCounter|RemoveCounter|GetCounter|IsCanAddCounter|IsCanRemoveCounter|EnableCounterPermit|SetCounterLimit|counter_list|counter_place_list)\s*\(?\s*(?:[^,()]*,\s*)?\{?\s*(0x[0-9a-fA-F]+|COUNTER_[A-Z0-9_]+)/g;
  const tipos = new Map();
  for (const arquivo of readdirSync(join(SCRIPTS_DIR, "official"))) {
    const texto = readFileSync(join(SCRIPTS_DIR, "official", arquivo), "utf8");
    for (const m of texto.matchAll(uso)) {
      const tipo = m[1].startsWith("0x") ? Number(m[1]) : constantes[m[1]];
      if (tipo) tipos.set(tipo, arquivo);
    }
  }
  const semNome = [...tipos].filter(([tipo]) => strings.counterName(tipo) === "Marcador");
  conferir(
    tipos.size > 50 && semNome.length === 0,
    `os ${tipos.size} tipos de contador usados nos scripts têm nome`,
    semNome.map(([tipo, arquivo]) => `0x${tipo.toString(16)} (${arquivo})`).join(", "),
  );
  conferir(strings.counterName(0x217) === "Marcador E.C.", "o E.C. Counter dos Enneacraft aparece pelo nome", strings.counterName(0x217));

  // Aviso cuja string o banco do ProjectIgnis deixa vazia (Burst Stream of
  // Destruction, str2): em vez de sumir, diz de qual carta vem.
  const burst = 17655904 * 0x100000 + 1;
  const texto = strings.hintText(burst, (code) => (code === 17655904 ? "Burst Stream of Destruction" : String(code)));
  conferir(
    texto === "Efeito de Burst Stream of Destruction",
    "aviso com string vazia no upstream aparece como \"Efeito de <carta>\"",
    String(texto),
  );
}

if (falhas.length) {
  console.log(`\n${falhas.length} falha(s):`);
  for (const falha of falhas) console.log(`  - ${falha}`);
  process.exitCode = 1;
} else {
  console.log("\nMarcas: tudo certo.");
}
process.exit();
