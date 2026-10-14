/**
 * Modos de resposta na corrente: quando a tela pergunta "deseja responder?".
 *
 * O core oferece uma janela de resposta (SELECT_CHAIN) em toda troca de fase,
 * passo de batalha, invocação e ativação em que o jogador tem carta legal —
 * com um Scapegoat baixado eram 35 perguntas em 4 turnos, 5 nos momentos em
 * que alguém responderia (docs/ui-ux-plano.md, §7). Os modos (`chain-mode.ts`)
 * decidem quais chegam à tela; este teste prova, na `DuelSession` real, que:
 *
 *   1. A regra pura (`chainWindowSkip`) faz o que diz, caso a caso.
 *   2. **Automático não cala o que importa:** a Ash Blossom é oferecida quando
 *      o oponente ativa uma busca; o Scapegoat, no ataque e na End Phase dele.
 *   3. **Automático cala o que não importa:** o Scapegoat deixa de ser
 *      oferecido em cada troca de fase — e encadear no próprio efeito some.
 *   4. **Sempre** é o comportamento antigo; **Nunca** não pergunta nada que não
 *      seja obrigatório.
 *   5. **Nenhum modo cala um gatilho:** a Invocação-Link da Halqifibrax com o
 *      Swap Cleric de material aciona os dois efeitos juntos; o core pergunta
 *      um, e com ele já na corrente pergunta o outro — essa segunda pergunta
 *      era respondida "não" sozinha (o elo de cima era meu) e o efeito sumia.
 *   6. **Ctrl segurado** (`forceAsk`) vale como "Sempre" sem trocar o modo, e
 *      a troca no meio do duelo vale a partir da janela seguinte.
 *
 * Os dois assentos são roteirizados aqui (nenhum bot): o oponente invoca e
 * ataca do mesmo jeito em todo modo, então as contagens se comparam.
 *
 * Uso: npm run test:chain-mode
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  OcgDuelMode,
  OcgLocation,
  OcgMessageType,
  OcgPhase,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
} from "@n1xx1/ocgcore-wasm";

import { botAutoResponse } from "@/lib/duel/bot-responder";
import { TRIGGER_WINDOW_SPE_COUNT, chainWindowSkip, isTriggerWindow } from "@/lib/duel/chain-mode";
import { createDuelSession } from "@/lib/duel/duel-session";
import { CardRegistry } from "@/lib/domain/card-registry";
import { nodeAssets } from "@/server/duel/node-assets";

import { REPO, loadGoatPool } from "./env.mjs";
import { Zone, createDuel } from "./duel.mjs";

const C = {
  celtic: 91152256, // Guerreiro de Nível 4 — o deck dos dois lados
  halqi: 50588353, // Crystron Halqifibrax: Link-2 com gatilho ao ser Invocado por Link
  cleric: 30968774, // Swap Cleric: gatilho ao ir para o Cemitério como matéria de Link
  elf: 69140098, // Gemini Elf: o atacante do oponente
  reinforcement: 32807846,
  ash: 14558127,
  scapegoat: 73915051,
  mst: 5318639,
};

const catalog = JSON.parse(readFileSync(join(REPO, ".cache/catalog/catalog.json"), "utf8"));
const registry = CardRegistry.fromCatalog(catalog);

const falhas = [];
function conferir(condicao, descricao, detalhe = "") {
  console.log(condicao ? `  ✓ ${descricao}` : `  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!condicao) falhas.push(descricao);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const BATTLE_STEPS =
  OcgPhase.BATTLE_START | OcgPhase.BATTLE_STEP | OcgPhase.DAMAGE | OcgPhase.DAMAGE_CAL | OcgPhase.BATTLE;

const idle = (action, index = null) => ({ type: OcgResponseType.SELECT_IDLECMD, action, index });
const PASSAR = { type: OcgResponseType.SELECT_CHAIN, index: null };

/**
 * Joga até o fim do turno `turnos`, com o assento 0 no `modo` pedido.
 *
 * Assento 1 (o "oponente"): ativa o Reforço quando tiver, invoca o Gemini Elf
 * e ataca com tudo. Assento 0: não faz nada no próprio turno além do que
 * `meuTurno` mandar, e passa toda janela — cada uma que chega é registrada.
 *
 * @returns as perguntas de corrente que chegaram ao assento 0.
 */
async function rodar({
  modo,
  scenario,
  turnos = 4,
  meuTurno = () => null,
  depoisDoTurno = {},
  // Main Deck do assento 0 (padrão: só Guardião Celta).
  deck = Array(40).fill(C.celtic),
  // Resposta do assento 0 a cada janela que chega; `null` = passar.
  naJanela = () => null,
  // Recebe o último estado da sessão (o log, a mesa) antes de sair.
  aoFim = () => {},
}) {
  const session = createDuelSession();
  let snap = null;
  session.subscribe((s) => {
    snap = s;
  });
  void session.start({
    playerName: "Ana",
    playerDeck: { main: deck, extra: [], side: [] },
    opponentName: "Bruno",
    opponentDeck: { main: Array(40).fill(C.celtic), extra: [], side: [] },
    registry,
    assets: nodeAssets,
    format: "tcg",
    scenario,
    pace: 0,
    seats: [
      { kind: "local", name: "Ana", chainMode: modo },
      { kind: "local", name: "Bruno", chainMode: "always" },
    ],
  });

  const perguntas = [];
  const jaAplicado = new Set();
  let ultimoId = -1;
  const limite = Date.now() + 120_000;
  while (Date.now() < limite) {
    await sleep(2);
    if (!snap) continue;
    if (snap.error) throw new Error(`sessão falhou: ${snap.error}`);
    if (snap.winner !== null || snap.turnCount > turnos) break;
    for (const [turno, acao] of Object.entries(depoisDoTurno)) {
      if (snap.turnCount > Number(turno) && !jaAplicado.has(turno)) {
        jaAplicado.add(turno);
        acao(session);
      }
    }
    const prompt = snap.pendingPrompt;
    if (!prompt || snap.isProcessing || snap.promptId === ultimoId) continue;
    ultimoId = snap.promptId;

    let resposta = null;
    if (snap.promptPlayer === 1) {
      if (prompt.type === OcgMessageType.SELECT_IDLECMD) {
        const reforco = prompt.activates.findIndex((c) => c.code === C.reinforcement);
        const elf = prompt.summons.findIndex((c) => c.code === C.elf);
        resposta =
          reforco >= 0
            ? idle(SelectIdleCMDAction.SELECT_ACTIVATE, reforco)
            : elf >= 0
              ? idle(SelectIdleCMDAction.SELECT_SUMMON, elf)
              : prompt.to_bp
                ? idle(SelectIdleCMDAction.TO_BP)
                : idle(SelectIdleCMDAction.TO_EP);
      } else if (prompt.type === OcgMessageType.SELECT_BATTLECMD) {
        resposta = prompt.attacks.length > 0
          ? { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: 0 }
          : { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_EP, index: null };
      } else if (prompt.type === OcgMessageType.SELECT_CHAIN && !prompt.forced) {
        resposta = PASSAR;
      } else if (prompt.type === OcgMessageType.SELECT_CARD) {
        // A busca do Reforço: o Gemini Elf, para ele ter com que atacar.
        const elf = prompt.selects.findIndex((c) => c.code === C.elf);
        resposta = elf >= 0
          ? { type: OcgResponseType.SELECT_CARD, indicies: [elf] }
          : botAutoResponse(prompt);
      } else {
        resposta = botAutoResponse(prompt);
      }
    } else if (prompt.type === OcgMessageType.SELECT_CHAIN) {
      const topo = snap.chainLinks.filter((l) => l.state === "pending").at(-1) ?? null;
      perguntas.push({
        turno: snap.turnCount,
        vez: snap.turnPlayer,
        fase: snap.phase,
        topo: topo ? topo.player : null,
        cartas: prompt.selects.map((c) => c.code),
      });
      resposta = naJanela(prompt, snap) ?? (prompt.forced ? botAutoResponse(prompt) : PASSAR);
    } else if (prompt.type === OcgMessageType.SELECT_IDLECMD) {
      resposta = meuTurno(prompt, snap) ?? idle(SelectIdleCMDAction.TO_EP);
    } else {
      resposta = botAutoResponse(prompt);
    }
    await session.respond(resposta, snap.promptId);
  }
  aoFim(snap);
  return perguntas;
}

// ---------------------------------------------------------------------------
console.log("\n1. A regra pura");
{
  const janela = (extra = {}) => ({
    type: OcgMessageType.SELECT_CHAIN,
    player: 0,
    spe_count: 0,
    forced: false,
    hint_timing: 0,
    hint_timing_other: 0,
    selects: [{ code: C.scapegoat, controller: 0, location: OcgLocation.SZONE, sequence: 0, position: 0, description: 0n, client_mode: 0 }],
    ...extra,
  });
  const fora = { topLinkPlayer: null };
  conferir(chainWindowSkip(janela(), "always", fora) === null, "Sempre: pergunta mesmo sem timing");
  conferir(chainWindowSkip(janela({ spe_count: 3 }), "never", fora) !== null, "Nunca: pula até janela relevante");
  conferir(chainWindowSkip(janela({ forced: true }), "never", fora) === null, "Nunca: obrigatório ainda pergunta");
  conferir(chainWindowSkip(janela({ selects: [] }), "auto", fora) === null, "sem candidato: não é com a regra (o autoResponse passa)");
  conferir(chainWindowSkip(janela(), "auto", fora) !== null, "Automático: fora de corrente e sem timing → pula");
  conferir(chainWindowSkip(janela({ spe_count: 1 }), "auto", fora) === null, "Automático: timing do momento → pergunta");
  conferir(chainWindowSkip(janela(), "auto", { topLinkPlayer: 1 }) === null, "Automático: o oponente ativou → pergunta");
  conferir(chainWindowSkip(janela({ spe_count: 2 }), "auto", { topLinkPlayer: 0 }) !== null, "Automático: encadear no próprio efeito → pula");
  // A janela dos gatilhos (spe_count 0x7f): passar descartaria o efeito.
  const gatilho = { spe_count: TRIGGER_WINDOW_SPE_COUNT };
  conferir(isTriggerWindow(janela(gatilho)) && !isTriggerWindow(janela({ spe_count: 2 })), "0x7f é a janela dos gatilhos; uma contagem comum não é");
  for (const modo of ["auto", "never", "always"]) {
    conferir(chainWindowSkip(janela(gatilho), modo, { topLinkPlayer: 0 }) === null, `${modo}: gatilho com o meu elo em cima → pergunta`);
    conferir(chainWindowSkip(janela(gatilho), modo, fora) === null, `${modo}: gatilhos juntos fora de corrente → pergunta`);
  }
  const pulo = chainWindowSkip(janela(), "never", fora);
  conferir(pulo?.type === OcgResponseType.SELECT_CHAIN && pulo.index === null, "o pulo é 'não responder'");
}

// ---------------------------------------------------------------------------
console.log("\n2. Ash Blossom na mão; o oponente ativa Reforço do Exército");
{
  const scenario = [
    { player: 0, location: OcgLocation.HAND, code: C.ash },
    { player: 1, location: OcgLocation.HAND, code: C.reinforcement },
  ];
  const comAsh = (lista) => lista.filter((p) => p.cartas.includes(C.ash));
  const auto = await rodar({ modo: "auto", scenario, turnos: 2 });
  const sempre = await rodar({ modo: "always", scenario, turnos: 2 });
  const nunca = await rodar({ modo: "never", scenario, turnos: 2 });
  console.log(`     Ash oferecida — sempre: ${comAsh(sempre).length}, automático: ${comAsh(auto).length}, nunca: ${comAsh(nunca).length}`);
  conferir(
    comAsh(auto).some((p) => p.topo === 1),
    "Automático: a Ash é oferecida na ativação do Reforço",
    JSON.stringify(auto),
  );
  conferir(comAsh(sempre).some((p) => p.topo === 1), "Sempre: idem");
  conferir(comAsh(nunca).length === 0, "Nunca: não pergunta", JSON.stringify(nunca));
}

// ---------------------------------------------------------------------------
console.log("\n3. Scapegoat baixado; o oponente invoca e ataca por 4 turnos");
let contagemSempre = 0;
{
  const scenario = [
    { player: 0, location: OcgLocation.SZONE, code: C.scapegoat },
    { player: 1, location: OcgLocation.HAND, code: C.elf },
  ];
  const sempre = await rodar({ modo: "always", scenario });
  const auto = await rodar({ modo: "auto", scenario });
  const nunca = await rodar({ modo: "never", scenario });
  contagemSempre = sempre.length;
  console.log(`     perguntas — sempre: ${sempre.length}, automático: ${auto.length}, nunca: ${nunca.length}`);
  conferir(sempre.length >= 20, `Sempre: o comportamento antigo (${sempre.length} perguntas)`);
  conferir(auto.length > 0 && auto.length <= 8, `Automático: poucas (${auto.length})`);
  conferir(
    auto.some((p) => p.vez === 1 && p.fase !== null && (p.fase & BATTLE_STEPS) !== 0),
    "Automático: pergunta no ataque do oponente",
    JSON.stringify(auto),
  );
  conferir(
    auto.some((p) => p.vez === 1 && p.fase === OcgPhase.END),
    "Automático: pergunta na End Phase do oponente",
  );
  conferir(
    !auto.some((p) => p.vez === 0),
    "Automático: nada no próprio turno (sem timing para o Scapegoat)",
    JSON.stringify(auto.filter((p) => p.vez === 0)),
  );
  conferir(nunca.length === 0, "Nunca: nenhuma");
}

// ---------------------------------------------------------------------------
console.log("\n4. Encadear no próprio efeito: ativo Reforço com MST baixado");
{
  const scenario = [
    { player: 0, location: OcgLocation.HAND, code: C.reinforcement },
    { player: 0, location: OcgLocation.SZONE, code: C.mst },
  ];
  const meuTurno = (() => {
    let ativou = false;
    return (prompt, snap) => {
      if (ativou || snap.turnCount !== 1) return null;
      const i = prompt.activates.findIndex((c) => c.code === C.reinforcement);
      if (i < 0) return null;
      ativou = true;
      return idle(SelectIdleCMDAction.SELECT_ACTIVATE, i);
    };
  });
  const auto = await rodar({ modo: "auto", scenario, turnos: 1, meuTurno: meuTurno() });
  const sempre = await rodar({ modo: "always", scenario, turnos: 1, meuTurno: meuTurno() });
  conferir(sempre.some((p) => p.topo === 0), "Sempre: oferece encadear no próprio Reforço");
  conferir(!auto.some((p) => p.topo === 0), "Automático: não oferece", JSON.stringify(auto));
}

// ---------------------------------------------------------------------------
console.log("\n5. Gatilhos juntos: Invocação-Link da Halqifibrax com o Swap Cleric de material");
{
  // As duas matérias já em campo (a Ash é a Regulador que a Halqifibrax
  // pede); as Ash do Deck são o alvo do efeito dela — sem alvo legal o core
  // nem aciona o gatilho.
  const scenario = [
    { player: 0, location: OcgLocation.MZONE, sequence: 0, code: C.cleric },
    { player: 0, location: OcgLocation.MZONE, sequence: 1, code: C.ash },
    { player: 0, location: OcgLocation.EXTRA, code: C.halqi },
  ];
  const deck = [...Array(37).fill(C.celtic), C.ash, C.ash, C.ash];
  const invocarHalqi = () => {
    let invocou = false;
    return (prompt, snap) => {
      if (invocou || snap.turnCount !== 1) return null;
      const i = prompt.special_summons.findIndex((c) => c.code === C.halqi);
      if (i < 0) return null;
      invocou = true;
      return idle(SelectIdleCMDAction.SELECT_SPECIAL_SUMMON, i);
    };
  };
  const GATILHOS = [C.halqi, C.cleric];
  // Ativa o gatilho que a ordem pede entre os oferecidos; a Ash (resposta,
  // não gatilho) fica sem resposta.
  const ativarNaOrdem = (ordem) => (prompt) => {
    for (const code of ordem) {
      const i = prompt.selects.findIndex((c) => c.code === code);
      if (i >= 0) return { type: OcgResponseType.SELECT_CHAIN, index: i };
    }
    return null;
  };
  for (const modo of ["auto", "never", "always"]) {
    for (const ordem of [GATILHOS, [...GATILHOS].reverse()]) {
      let log = [];
      const perguntas = await rodar({
        modo,
        scenario,
        deck,
        turnos: 1,
        meuTurno: invocarHalqi(),
        naJanela: ativarNaOrdem(ordem),
        aoFim: (snap) => {
          log = snap.log.map((linha) => linha.text);
        },
      });
      const segundo = ordem[1];
      const rotulo = `${modo}, ${ordem[0] === C.halqi ? "Link primeiro" : "material primeiro"}`;
      conferir(
        perguntas.some((p) => p.topo === 0 && p.cartas.length === 1 && p.cartas[0] === segundo),
        `${rotulo}: com o 1º gatilho na corrente, o 2º chega à tela`,
        JSON.stringify(perguntas),
      );
      conferir(
        log.some((linha) => linha.includes("Elo 1")) && log.some((linha) => linha.includes("Elo 2")),
        `${rotulo}: os dois efeitos entram na corrente`,
        log.filter((linha) => linha.includes("⛓")).join(" | "),
      );
      conferir(
        log.some((linha) => linha.includes("comprou")),
        `${rotulo}: o Swap Cleric resolve (compra 1)`,
      );
      if (modo === "auto") {
        // A regra do *Self Chain* continua valendo para resposta de verdade:
        // a Ash do Deck que veio para a mão não é oferecida contra o próprio
        // efeito da Halqifibrax.
        conferir(
          !perguntas.some((p) => p.cartas.includes(C.ash)),
          `${rotulo}: a Ash contra o próprio efeito segue calada`,
          JSON.stringify(perguntas),
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
console.log("\n6. Ctrl segurado e troca no meio do duelo");
{
  const scenario = [
    { player: 0, location: OcgLocation.SZONE, code: C.scapegoat },
    { player: 1, location: OcgLocation.HAND, code: C.elf },
  ];
  const segurando = await rodar({
    modo: "auto",
    scenario,
    depoisDoTurno: { 0: (session) => session.setChainPreference(0, { forceAsk: true }) },
  });
  conferir(
    segurando.length >= contagemSempre - 2,
    `Ctrl segurado no automático pergunta como o Sempre (${segurando.length} × ${contagemSempre})`,
  );

  const trocou = await rodar({
    modo: "never",
    scenario,
    depoisDoTurno: { 2: (session) => session.setChainPreference(0, { mode: "always" }) },
  });
  conferir(
    trocou.length > 0 && trocou.every((p) => p.turno >= 3),
    `Nunca → Sempre no 3º turno: perguntas só a partir dele (${trocou.length})`,
    JSON.stringify(trocou.map((p) => p.turno)),
  );
}

// ---------------------------------------------------------------------------
// 7. Medição em partidas inteiras.
//
// Os cenários acima provam a regra; esta parte mede o efeito num jogo de
// verdade: decks pré-montados, os dois lados jogando com o piloto automático,
// e cada janela de resposta do assento 0 passada pela regra nos três modos —
// a MESMA partida, contada três vezes. É o número que entra no plano (§11).
// ---------------------------------------------------------------------------
console.log("\n7. Medição: perguntas ao assento 0 em partidas inteiras");
{
  const goatPool = new Set(loadGoatPool().map((card) => card.id));
  const goat = JSON.parse(readFileSync(join(REPO, "src/data/preset-decks.json"), "utf8"));
  const tcg = JSON.parse(readFileSync(join(REPO, "src/data/preset-decks-tcg.json"), "utf8"));
  const PARTIDAS = Number(process.env.CHAIN_MODE_PARTIDAS ?? 8);

  async function medir(formato) {
    const total = { janelas: 0, always: 0, auto: 0, never: 0, gatilhos: 0, oponenteAtivou: 0, autoNaAtivacao: 0, fins: {}, turnos: 0 };
    for (let rodada = 0; rodada < PARTIDAS; rodada += 1) {
      const lista = formato === "goat" ? goat : tcg;
      const a = lista[(rodada * 3) % lista.length];
      const b = lista[(rodada * 3 + 5) % lista.length];
      const principal = (preset) =>
        formato === "goat" ? preset.main.filter((code) => goatPool.has(code)) : preset.main;
      const extra = (player, preset) =>
        formato === "goat" ? [] : (preset.extra ?? []).map((code) => ({ player, zone: Zone.EXTRA, code }));
      const duel = await createDuel({
        mode: formato === "goat" ? OcgDuelMode.MODE_GOAT : OcgDuelMode.MODE_MR5,
        decks: [principal(a), principal(b)],
        place: [...extra(0, a), ...extra(1, b)],
        seed: BigInt(7000 + rodada * 13),
        startingDraw: 5,
      });
      // A corrente aberta, reconstruída das mensagens como a sessão faz.
      let pendentes = [];
      let lidas = 0;
      const fim = duel.run((prompt, d) => {
        for (const m of d.messages.slice(lidas)) {
          if (m.type === OcgMessageType.CHAINING) pendentes.push(m.controller);
          else if (m.type === OcgMessageType.CHAIN_SOLVING) pendentes = pendentes.slice(0, m.chain_size - 1);
          else if (m.type === OcgMessageType.CHAIN_END) pendentes = [];
        }
        lidas = d.messages.length;
        if (
          prompt.type === OcgMessageType.SELECT_CHAIN &&
          prompt.player === 0 &&
          prompt.selects.length > 0 &&
          !prompt.forced
        ) {
          const contexto = { topLinkPlayer: pendentes.at(-1) ?? null };
          total.janelas += 1;
          for (const modo of ["always", "auto", "never"]) {
            if (!chainWindowSkip(prompt, modo, contexto)) total[modo] += 1;
          }
          if (isTriggerWindow(prompt)) total.gatilhos += 1;
          if (contexto.topLinkPlayer === 1) {
            total.oponenteAtivou += 1;
            if (!chainWindowSkip(prompt, "auto", contexto)) total.autoNaAtivacao += 1;
          }
        }
        return null;
      }, { play: true });
      total.fins[fim] = (total.fins[fim] ?? 0) + 1;
      total.turnos += duel.of(OcgMessageType.NEW_TURN).length;
      duel.destroy();
    }
    return total;
  }

  for (const formato of ["goat", "tcg"]) {
    const t = await medir(formato);
    console.log(
      `     ${formato.toUpperCase()} (${PARTIDAS} partidas): janelas com resposta legal ${t.janelas} → ` +
        `Sempre ${t.always}, Automático ${t.auto}, Nunca ${t.never} (janelas de gatilho: ${t.gatilhos}); ` +
        `ativações do oponente com resposta possível: ${t.oponenteAtivou}, perguntadas no Automático: ${t.autoNaAtivacao} ` +
        `(${t.turnos} turnos; fins: ${JSON.stringify(t.fins)})`,
    );
    conferir(t.turnos >= PARTIDAS * 4, `${formato}: as partidas foram jogadas de verdade (${t.turnos} turnos)`);
    conferir(t.always === t.janelas, `${formato}: Sempre pergunta toda janela`);
    conferir(t.auto <= t.always, `${formato}: Automático nunca pergunta mais que Sempre`);
    // As janelas de gatilho são perguntadas em todo modo (seção 5); fora
    // delas, o Nunca não pergunta nada opcional.
    conferir(t.never === t.gatilhos, `${formato}: Nunca só pergunta gatilho (${t.never} × ${t.gatilhos})`);
    conferir(
      t.autoNaAtivacao === t.oponenteAtivou,
      `${formato}: toda ativação do oponente com resposta possível continua perguntada`,
    );
  }
}

console.log(falhas.length === 0 ? "\nOK — modos de resposta" : `\nFALHOU (${falhas.length}): ${falhas.join("; ")}`);
process.exit(falhas.length === 0 ? 0 : 1);
