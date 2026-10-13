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

import { banStatus, banlistSummary, canAddCard, deckValidationMessages } from "@/lib/domain/deck-rules";
import { createEmptyDeck, normalizeDeck } from "@/lib/domain/deck-operations";
import { deckToDuelPayload } from "@/lib/domain/deck-serializer";
import { DuelRoom, deckProblem } from "@/server/duel/room";

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

// ---------------------------------------------------------------------------
// Regras de deck por formato — sem duelo.
// ---------------------------------------------------------------------------
console.log("\nDecks e formatos");
{
  const catalogo = JSON.parse(readFileSync(join(REPO, ".cache/catalog/catalog.json"), "utf8"));
  const cat = CardRegistry.fromCatalog(catalogo);
  const LINK_SPIDER = 98978921;
  const CYBER_STEIN = 69015963;
  const GAIA = 66889139;

  // Deck salvo antes do TCG: sem `format`.
  const antigo = { id: "antigo01", name: "Velho", main: [{ passcode: BOI, quantity: 3 }], extra: [], side: [], updatedAt: "2026-01-01T00:00:00.000Z" };
  conferir(normalizeDeck(antigo).format === "goat", "deck antigo, sem formato, abre como Goat");
  conferir(deckToDuelPayload(normalizeDeck(antigo)).format === "goat", "e vai ao duelo como Goat");

  const goat = createEmptyDeck("G", "goat");
  const tcg = createEmptyDeck("T", "tcg");
  conferir(!canAddCard(goat, cat.get(LINK_SPIDER), "extra").ok, "um Link não entra num deck Goat");
  conferir(canAddCard(tcg, cat.get(LINK_SPIDER), "extra").ok, "um Link entra no Extra de um deck TCG");
  conferir(canAddCard(goat, cat.get(GAIA), "extra").ok, "Gaia (Fusão de 2005) entra no Extra Goat");

  const extraCheio = (formato, n) => ({
    ...createEmptyDeck("X", formato),
    extra: [{ passcode: GAIA, quantity: n }],
  });
  conferir(!canAddCard(extraCheio("tcg", 15), cat.get(LINK_SPIDER), "extra").ok, "Extra Deck TCG para em 15");
  conferir(canAddCard(extraCheio("goat", 15), cat.get(GAIA), "extra").ok === false, "(3 cópias já no Extra Goat: o limite de cópias vale)");
  conferir(
    canAddCard({ ...createEmptyDeck("X", "goat"), extra: [{ passcode: 1, quantity: 15 }] }, cat.get(GAIA), "extra").ok,
    "Extra Goat passa de 15 (até 60)",
  );
  conferir(
    deckValidationMessages({ ...createEmptyDeck("S", "tcg"), main: [{ passcode: BOI, quantity: 40 }], side: [{ passcode: BOI, quantity: 7 }] }).length === 0,
    "Side Deck de 7 vale no TCG",
  );
  conferir(
    deckValidationMessages({ ...createEmptyDeck("S", "goat"), main: [{ passcode: BOI, quantity: 40 }], side: [{ passcode: BOI, quantity: 7 }] }).length === 1,
    "mas no Goat é 0 ou 15",
  );

  conferir(banStatus(cat.get(CYBER_STEIN), "goat") === null, "Cyber-Stein não aparece proibida na lista de 2005");
  conferir(banStatus(cat.get(CYBER_STEIN), "tcg") === "Forbidden", "e aparece proibida na banlist TCG");
  const comProibida = { ...createEmptyDeck("B", "tcg"), main: [{ passcode: CYBER_STEIN, quantity: 1 }] };
  const resumo = banlistSummary(comProibida, cat);
  conferir(!resumo.ok && /1 Proibida/.test(resumo.text), "o resumo do deck avisa a Proibida — sem bloquear", resumo.text);
  conferir(canAddCard(comProibida, cat.get(CYBER_STEIN), "main").ok, "e ainda dá para pôr outra cópia (banlist é só informação)");

  conferir(
    deckProblem({ main: Array(40).fill(BOI), extra: Array(16).fill(GAIA), side: [], format: "tcg" }) !== null,
    "online: Extra de 16 é recusado num deck TCG",
  );
  conferir(
    deckProblem({ main: Array(40).fill(BOI), extra: Array(16).fill(GAIA), side: [], format: "goat" }) === null,
    "e aceito num deck Goat",
  );
}

console.log("\nSala online: formatos diferentes não começam");
{
  const mensagens = { a: [], b: [] };
  const sala = new DuelRoom("FMT1");
  const deckDe = (format) => ({ main: Array(40).fill(BOI), extra: [], side: [], format });
  sala.join({ token: "token-a-xxxxxxxxxxxx", name: "Ana", deck: deckDe("goat"), send: (m) => mensagens.a.push(m) });
  sala.join({ token: "token-b-xxxxxxxxxxxx", name: "Bruno", deck: deckDe("tcg"), send: (m) => mensagens.b.push(m) });
  sala.setReady("token-a-xxxxxxxxxxxx", true);
  sala.setReady("token-b-xxxxxxxxxxxx", true);
  const lobby = mensagens.a.filter((m) => m.t === "lobby").at(-1);
  conferir(lobby && !lobby.jokenpo && !lobby.started, "Goat × TCG: os dois prontos e o jokenpô não abre");
  conferir(
    lobby?.seats.map((seat) => seat.format).sort().join() === "goat,tcg",
    "e a sala mostra o formato de cada um",
    JSON.stringify(lobby?.seats),
  );
  sala.setDeck("token-b-xxxxxxxxxxxx", deckDe("goat"), "Goat também");
  sala.setReady("token-b-xxxxxxxxxxxx", true);
  const depois = mensagens.a.filter((m) => m.t === "lobby").at(-1);
  conferir(Boolean(depois?.jokenpo), "trocando para o mesmo formato, o jokenpô abre");
}

if (falhas.length) {
  console.log(`\n${falhas.length} falha(s):`);
  for (const falha of falhas) console.log(`  - ${falha}`);
  process.exitCode = 1;
} else {
  console.log("\nFormatos: tudo certo.");
}
