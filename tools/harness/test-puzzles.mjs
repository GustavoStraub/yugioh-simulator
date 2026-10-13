/**
 * Os duelos-problema têm solução — e a solução é a que o enunciado sugere.
 *
 * Cada puzzle de `src/lib/data/puzzles.ts` é jogado na `DuelSession` real,
 * com o bot de verdade do outro lado (é ele quem decide ativar a armadilha),
 * nas regras do modo puzzle (sem mão inicial, LP do problema, ataque no
 * primeiro turno). Para cada um:
 *
 *   1. a solução escrita vence NESTE turno;
 *   2. onde há uma armadilha, o caminho ingênuo NÃO vence — senão o puzzle
 *      não ensinaria nada.
 *
 * Uso: npm run test:puzzles
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  OcgMessageType,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
} from "@n1xx1/ocgcore-wasm";

import { PUZZLES } from "@/lib/data/puzzles";
import { botAutoResponse } from "@/lib/duel/bot-responder";
import { createDuelSession } from "@/lib/duel/duel-session";
import { CardRegistry } from "@/lib/domain/card-registry";
import { nodeAssets } from "@/server/duel/node-assets";

import { REPO } from "./env.mjs";

const catalog = JSON.parse(readFileSync(join(REPO, ".cache/catalog/catalog.json"), "utf8"));
const registry = CardRegistry.fromCatalog(catalog);

const falhas = [];
function conferir(condicao, descricao, detalhe = "") {
  console.log(condicao ? `  ✓ ${descricao}` : `  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!condicao) falhas.push(descricao);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const C = {
  raigeki: 12580477,
  mst: 5318639,
  changeOfHeart: 4031928,
  elf: 69140098,
  horseman: 68516705,
  celtic: 91152256,
  mirrorForce: 44095762,
};

/**
 * Um jeito de jogar o turno: as cartas a ativar (na ordem), os atacantes (na
 * ordem) e em quem bater quando o core pergunta o alvo.
 */
function roteiro({ ativar = [], atacantes = [], alvoDoAtaque = null }) {
  const ativadas = new Set();
  const atacaram = new Set();
  return (prompt) => {
    switch (prompt.type) {
      case OcgMessageType.SELECT_IDLECMD: {
        for (const code of ativar) {
          if (ativadas.has(code)) continue;
          const i = prompt.activates.findIndex((c) => c.code === code);
          if (i >= 0) {
            ativadas.add(code);
            return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index: i };
          }
        }
        return prompt.to_bp
          ? { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null }
          : { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null };
      }
      case OcgMessageType.SELECT_BATTLECMD: {
        for (const code of atacantes) {
          if (atacaram.has(code)) continue;
          const i = prompt.attacks.findIndex((c) => c.code === code);
          if (i >= 0) {
            atacaram.add(code);
            return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: i };
          }
        }
        return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_EP, index: null };
      }
      case OcgMessageType.SELECT_CARD: {
        // Alvo de efeito: sempre do oponente; alvo de ataque: o pedido.
        const preferido =
          prompt.selects.findIndex((c) => alvoDoAtaque !== null && c.code === alvoDoAtaque) >= 0
            ? prompt.selects.findIndex((c) => c.code === alvoDoAtaque)
            : prompt.selects.findIndex((c) => c.controller === 1);
        if (preferido >= 0) return { type: OcgResponseType.SELECT_CARD, indicies: [preferido] };
        return botAutoResponse(prompt);
      }
      case OcgMessageType.SELECT_CHAIN:
        return { type: OcgResponseType.SELECT_CHAIN, index: null };
      default:
        return botAutoResponse(prompt);
    }
  };
}

/** Joga o turno 1 do puzzle com o roteiro dado; devolve o snapshot final. */
async function jogar(puzzle, decidir) {
  const session = createDuelSession();
  let snap = null;
  session.subscribe((s) => {
    snap = s;
  });
  void session.start({
    playerName: "Você",
    playerDeck: { main: puzzle.deck, extra: [], side: [] },
    opponentName: "Bot",
    opponentDeck: { main: puzzle.opponentDeck, extra: [], side: [] },
    registry,
    assets: nodeAssets,
    format: puzzle.format,
    scenario: puzzle.scenario,
    puzzle: { lifePoints: puzzle.lifePoints },
    pace: 0,
  });
  let ultimo = -1;
  const limite = Date.now() + 60_000;
  while (Date.now() < limite) {
    await sleep(2);
    if (!snap) continue;
    if (snap.error) throw new Error(`sessão falhou: ${snap.error}`);
    if (snap.winner !== null || snap.turnCount > 1) break;
    const prompt = snap.pendingPrompt;
    if (!prompt || snap.isProcessing || snap.promptId === ultimo || snap.promptPlayer !== 0) continue;
    ultimo = snap.promptId;
    await session.respond(decidir(prompt), snap.promptId);
  }
  return snap;
}

const SOLUCOES = {
  "raio-final": { ativar: [C.raigeki], atacantes: [C.elf] },
  "abra-caminho": { ativar: [C.mst], atacantes: [C.elf, C.celtic], alvoDoAtaque: C.horseman },
  "mudanca-de-opiniao": { ativar: [C.changeOfHeart], atacantes: [C.elf, C.horseman] },
};
const INGENUOS = {
  "raio-final": { atacantes: [C.elf], alvoDoAtaque: C.horseman },
  "abra-caminho": { atacantes: [C.elf, C.celtic], alvoDoAtaque: C.horseman },
  "mudanca-de-opiniao": { atacantes: [C.horseman], alvoDoAtaque: C.elf },
};

for (const puzzle of PUZZLES) {
  console.log(`\n${puzzle.title} (${puzzle.id})`);
  conferir(Boolean(SOLUCOES[puzzle.id]), "tem solução escrita no teste");
  if (!SOLUCOES[puzzle.id]) continue;

  const resolvido = await jogar(puzzle, roteiro(SOLUCOES[puzzle.id]));
  conferir(
    resolvido.winner === 0 && resolvido.turnCount === 1,
    `a solução vence no turno 1 (vencedor ${resolvido.winner}, LP do oponente ${resolvido.lifePoints[1]})`,
    resolvido.log.map((l) => l.text).filter((t) => !t.startsWith("—")).slice(-8).join(" | "),
  );
  conferir(
    resolvido.log.some((l) => l.text.startsWith("Turno 1")) &&
      (resolvido.boards[0]?.players[0].hand.length ?? 99) <= 1,
    "começa sem mão inicial comprada (só as cartas do problema)",
  );

  const ingenuo = await jogar(puzzle, roteiro(INGENUOS[puzzle.id]));
  conferir(
    ingenuo.winner !== 0,
    `o caminho ingênuo não vence (LP do oponente ${ingenuo.lifePoints[1]})`,
    ingenuo.log.map((l) => l.text).slice(-6).join(" | "),
  );
  if (puzzle.id === "abra-caminho") {
    conferir(
      ingenuo.log.some((l) => l.codes?.includes(C.mirrorForce) && l.text.includes("Elo")),
      "e é a Força do Espelho do bot que o pune",
    );
  }
}

console.log(falhas.length === 0 ? "\nPuzzles: todos têm solução, e só ela vence." : `\nFALHOU (${falhas.length}): ${falhas.join("; ")}`);
process.exit(falhas.length === 0 ? 0 : 1);
