/**
 * Aprender jogando (Fase 12): as peças puras — glossário e dicas — e o
 * modo espectador na `DuelSession` real.
 *
 *   - Glossário: acha os termos em português e em inglês, a grafia mais longa
 *     ganha ("Invocação-Tributo" e não "Tributo"), não acha termo dentro de
 *     outra palavra, só sublinha a primeira ocorrência e não perde texto.
 *   - Dicas: uma por vez, na prioridade certa, e nunca de novo depois de vista.
 *   - Bot × bot: os dois assentos jogam sozinhos, ninguém é perguntado, e o
 *     tabuleiro do assento assistido é lido (o outro não).
 *
 * Uso: npm run test:learning
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { GLOSSARY, glossarySegments } from "@/lib/domain/glossary";
import { nextTip, parseTips, TIPS } from "@/lib/duel/tips";
import { createDuelSession } from "@/lib/duel/duel-session";
import { CardRegistry } from "@/lib/domain/card-registry";
import { nodeAssets } from "@/server/duel/node-assets";

import { REPO } from "./env.mjs";

const falhas = [];
function conferir(condicao, descricao, detalhe = "") {
  console.log(condicao ? `  ✓ ${descricao}` : `  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!condicao) falhas.push(descricao);
}
const termos = (texto) => glossarySegments(texto).filter((s) => s.term).map((s) => s.term.id);

console.log("Glossário");
{
  const pt = "Se este card for Invocado por Invocação-Normal: você pode banir 1 card do Cemitério do seu adversário.";
  conferir(
    JSON.stringify(termos(pt)) === JSON.stringify(["normal-summon", "banish", "graveyard"]),
    "acha os termos em português, na ordem",
    JSON.stringify(termos(pt)),
  );
  const en = "If this card is Normal Summoned: You can banish 1 card from your opponent's GY.";
  conferir(
    JSON.stringify(termos(en)) === JSON.stringify(["normal-summon", "banish", "graveyard"]),
    "e em inglês",
    JSON.stringify(termos(en)),
  );
  conferir(termos("Invocação-Tributo de um monstro: 2 Tributos.").join() === "tribute", "a grafia mais longa ganha, e o termo só é marcado uma vez");
  conferir(termos("Linkuriboh e Settle").length === 0, "não acha termo dentro de outra palavra");
  conferir(termos("set the table").length === 0 && termos("Set 1 Spell").join() === "set", "\"Set\" só com maiúscula (o verbo da carta)");
  const texto = "Escolha 1 Magia/Armadilha no campo; destrua o alvo.";
  conferir(glossarySegments(texto).map((s) => s.text).join("") === texto, "o texto volta inteiro, sem perder nada");
  conferir(GLOSSARY.every((t) => t.definition.length > 30 && t.aliases.length > 0), "todo termo tem definição e grafia");
}

console.log("Dicas");
{
  const vazio = { myPrompt: false, canPlay: false, battle: false, chainWindow: false, decisionOpen: false, inlineSelection: false };
  const nenhuma = new Set();
  conferir(nextTip({ ...vazio, chainWindow: true, decisionOpen: true }, nenhuma)?.id === "corrente", "a janela de resposta vem antes do 'ver a mesa'");
  conferir(nextTip({ ...vazio, decisionOpen: true }, nenhuma)?.id === "esconder", "diálogo aberto → 'Ver a mesa'");
  conferir(nextTip({ ...vazio, canPlay: true }, nenhuma)?.id === "jogar", "Main Phase com jogada → como jogar");
  conferir(nextTip({ ...vazio, canPlay: true }, new Set(["jogar"]))?.id === "ler", "vista a de jogar, vem a de ler");
  conferir(nextTip(vazio, new Set(TIPS.map((t) => t.id))) === null, "todas vistas → nenhuma");
  conferir(parseTips("lixo").off === false && parseTips('{"off":true,"seen":["a",3]}').seen.join() === "a", "o estado guardado é lido com cuidado");
}

console.log("Bot × bot (espectador)");
{
  const catalog = JSON.parse(readFileSync(join(REPO, ".cache/catalog/catalog.json"), "utf8"));
  const registry = CardRegistry.fromCatalog(catalog);
  const presets = JSON.parse(readFileSync(join(REPO, "src/data/preset-decks.json"), "utf8"));
  const session = createDuelSession();
  let snap = null;
  let perguntas = 0;
  let maoPropriaVisivel = false;
  session.subscribe((s) => {
    snap = s;
    if (s.pendingPrompt) perguntas += 1;
    if (s.boards[0]?.players[0].hand.some((card) => card.code !== null)) maoPropriaVisivel = true;
  });
  void session.start({
    playerName: "A",
    playerDeck: { main: presets[0].main, extra: [], side: [] },
    opponentName: "B",
    opponentDeck: { main: presets[1].main, extra: [], side: [] },
    registry,
    assets: nodeAssets,
    pace: 0,
    seats: [
      { kind: "bot", name: "Bot A" },
      { kind: "bot", name: "Bot B" },
    ],
    watchSeat: 0,
  });
  const limite = Date.now() + 90_000;
  while (Date.now() < limite && (snap?.turnCount ?? 0) < 4 && snap?.winner === null) {
    await new Promise((r) => setTimeout(r, 20));
    if (snap?.error) throw new Error(snap.error);
  }
  conferir((snap?.turnCount ?? 0) >= 4 || snap?.winner !== null, `os dois bots jogam sozinhos (turno ${snap?.turnCount})`);
  conferir(perguntas === 0, "ninguém é perguntado");
  conferir(snap?.boards[0] !== null && snap?.boards[1] === null, "o tabuleiro do assento assistido é lido; o outro, não");
  // Em ritmo zero, vários turnos podem passar antes de o teste recuperar a
  // execução. A mão final pode estar vazia: verificar a visibilidade durante
  // a sessão evita confundir gastar a mão com ocultá-la do espectador.
  conferir(maoPropriaVisivel, "e quem assiste vê a mão do assento 0");
}

console.log(falhas.length === 0 ? "\nAprender jogando: tudo certo." : `\nFALHOU (${falhas.length}): ${falhas.join("; ")}`);
process.exit(falhas.length === 0 ? 0 : 1);
