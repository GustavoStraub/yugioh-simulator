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
 *   5. **Ctrl segurado** (`forceAsk`) vale como "Sempre" sem trocar o modo, e
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
  OcgLocation,
  OcgMessageType,
  OcgPhase,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
} from "@n1xx1/ocgcore-wasm";

import { botAutoResponse } from "@/lib/duel/bot-responder";
import { chainWindowSkip } from "@/lib/duel/chain-mode";
import { createDuelSession } from "@/lib/duel/duel-session";
import { CardRegistry } from "@/lib/domain/card-registry";
import { nodeAssets } from "@/server/duel/node-assets";

import { REPO } from "./env.mjs";

const C = {
  celtic: 91152256, // Guerreiro de Nível 4 — o deck dos dois lados
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
async function rodar({ modo, scenario, turnos = 4, meuTurno = () => null, depoisDoTurno = {} }) {
  const session = createDuelSession();
  let snap = null;
  session.subscribe((s) => {
    snap = s;
  });
  void session.start({
    playerName: "Ana",
    playerDeck: { main: Array(40).fill(C.celtic), extra: [], side: [] },
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
      resposta = prompt.forced ? botAutoResponse(prompt) : PASSAR;
    } else if (prompt.type === OcgMessageType.SELECT_IDLECMD) {
      resposta = meuTurno(prompt, snap) ?? idle(SelectIdleCMDAction.TO_EP);
    } else {
      resposta = botAutoResponse(prompt);
    }
    await session.respond(resposta, snap.promptId);
  }
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
console.log("\n5. Ctrl segurado e troca no meio do duelo");
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

console.log(falhas.length === 0 ? "\nOK — modos de resposta" : `\nFALHOU (${falhas.length}): ${falhas.join("; ")}`);
process.exit(falhas.length === 0 ? 0 : 1);
