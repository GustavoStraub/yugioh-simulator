/**
 * Os dois formatos lado a lado: o duelo roda com as regras do formato pedido?
 *
 * O formato chega à `DuelSession` pela config e vira a flag do core
 * (`MODE_GOAT` ou `MODE_MR5`). Errar aqui não quebra nada à vista: o duelo
 * roda liso com a regra errada, e só quem conhece o formato percebe — o Goat
 * sem a compra do primeiro turno, ou um deck TCG jogando sem Zona Extra.
 *
 * O teste usa a sessão de verdade (a classe que a tela usa) e confere a regra
 * mais fácil de observar de fora: **quem começa compra no primeiro turno?** No
 * Goat sim (6 cartas na Main Phase 1), no TCG não (5).
 *
 * Uso: npm run test:formats
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { OcgMessageType } from "@n1xx1/ocgcore-wasm";

import { botAutoResponse } from "@/lib/duel/bot-responder";
import { createDuelSession } from "@/lib/duel/duel-session";
import { CardRegistry } from "@/lib/domain/card-registry";
import { nodeAssets } from "@/server/duel/node-assets";

import { REPO } from "./env.mjs";

/** Battle Ox — deck neutro, sem efeito nenhum no caminho. */
const BOI = 5053103;

const pool = JSON.parse(readFileSync(join(REPO, ".cache/goat-pool.json"), "utf8")).data;
const registry = CardRegistry.fromApiResponse(pool);

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

/**
 * Começa um duelo no formato pedido e devolve o snapshot no primeiro
 * SELECT_IDLECMD do assento 0 — a Main Phase 1 de quem começa.
 */
async function primeiraMainPhase(format) {
  const session = createDuelSession();
  let snap = null;
  session.subscribe((s) => {
    snap = s;
  });
  void session.start({
    playerName: "Eu",
    playerDeck: { main: Array(40).fill(BOI), extra: [], side: [] },
    opponentName: "Bot",
    opponentDeck: { main: Array(40).fill(BOI), extra: [], side: [] },
    registry,
    assets: nodeAssets,
    format,
    seats: [
      { kind: "local", name: "Eu" },
      { kind: "bot", name: "Bot" },
    ],
  });

  const limite = Date.now() + 60_000;
  while (Date.now() < limite) {
    await sleep(10);
    if (!snap) continue;
    if (snap.error) throw new Error(`sessão falhou: ${snap.error}`);
    const prompt = snap.pendingPrompt;
    if (!prompt || snap.isProcessing || snap.promptPlayer !== 0) continue;
    if (prompt.type === OcgMessageType.SELECT_IDLECMD) return snap;
    await session.respond(botAutoResponse(prompt), snap.promptId);
  }
  throw new Error("o duelo não chegou à Main Phase 1");
}

for (const [format, maoEsperada] of [
  ["goat", 6],
  ["tcg", 5],
]) {
  console.log(`\nFormato ${format}`);
  const snap = await primeiraMainPhase(format);
  conferir(snap.format === format, `o snapshot diz o formato (${snap.format})`);
  conferir(snap.turnCount === 1, `é o primeiro turno (${snap.turnCount})`);
  const mao = snap.boards[0]?.players[0].hand.length ?? -1;
  conferir(
    mao === maoEsperada,
    `quem começa tem ${maoEsperada} cartas na Main Phase 1 (${mao})`,
  );
}

if (falhas.length) {
  console.log(`\n${falhas.length} falha(s):`);
  for (const falha of falhas) console.log(`  - ${falha}`);
  process.exitCode = 1;
} else {
  console.log("\nFormatos: tudo certo.");
}
