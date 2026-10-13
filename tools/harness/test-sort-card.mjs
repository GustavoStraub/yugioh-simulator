/**
 * "Veja as N cartas do topo e recoloque na ordem que quiser" — a ordem que o
 * jogador escolhe é a que fica no Deck?
 *
 * Dois bugs moravam aqui, um em cima do outro:
 *
 * 1. **O binding** escrevia a quantidade antes da ordem (`[n, o0, o1, …]`) e o
 *    core lê a ordem direto do byte 0. Toda ordem explícita era recusada
 *    (RETRY) — a tela travava e o bot tinha o duelo interrompido. Consertado
 *    no `postinstall` (`scripts/copy-ocgcore-wasm.mjs`); se o conserto não
 *    estiver aplicado, este teste trava em RETRY_LOOP.
 * 2. **A tela** mandava "para cada posição, a carta", e o core lê "para cada
 *    carta, a posição" (`field::sort_deck`). Com 3 cartas, escolher
 *    `[C, A, B]` deixava B no topo. Consertado em `sortOrderForCore`.
 *
 * O teste usa Card Advance (olhe até 5 do topo, recoloque em qualquer ordem),
 * responde pelo MESMO caminho da tela (`buildPromptPlan(...).sorting.build`)
 * e confere o Deck depois.
 *
 * Uso: npm run test:sort-card
 */
import { OcgLocation, OcgMessageType, OcgResponseType, SelectIdleCMDAction } from "@n1xx1/ocgcore-wasm";

import { botAutoResponse } from "@/lib/duel/bot-responder";
import { buildPromptPlan } from "@/lib/duel/duel-actions";

import { createDuel, STOP, Zone } from "./duel.mjs";

const CARD_ADVANCE = 52112003;
// Monstros Normais, só para serem distinguíveis no Deck.
const BATTLE_OX = 5053103;
const BLUE_EYES = 89631139;
const DARK_MAGICIAN = 46986414;
const SUMMONED_SKULL = 70781052;
const CELTIC_GUARDIAN = 91152256;

const falhas = [];
function conferir(condicao, descricao, detalhe = "") {
  console.log(condicao ? `  ✓ ${descricao}` : `  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!condicao) falhas.push(descricao);
}

/**
 * Ativa Card Advance olhando `quantas` cartas e responde a ordenação com
 * `responder(mensagem)`.
 *
 * @returns as cartas mostradas (a 1ª é o topo), o Deck do topo para baixo
 *   depois da ordenação e o desfecho do laço.
 */
async function ordenar(quantas, responder) {
  const duel = await createDuel({
    // O core empilha na ordem de inserção: a última carta é o topo. São 6
    // porque o Goat compra no primeiro turno — sobram 5 para olhar.
    decks: [
      [BATTLE_OX, BATTLE_OX, BLUE_EYES, DARK_MAGICIAN, SUMMONED_SKULL, CELTIC_GUARDIAN],
      Array(6).fill(BATTLE_OX),
    ],
    place: [{ player: 0, zone: Zone.HAND, code: CARD_ADVANCE }],
  });
  let mostradas = null;
  const desfecho = duel.run((message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 0) {
      if (mostradas) return STOP;
      const index = message.activates.findIndex((a) => a.code === CARD_ADVANCE);
      if (index >= 0) {
        return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index };
      }
    }
    if (message.type === OcgMessageType.ANNOUNCE_NUMBER) {
      return {
        type: OcgResponseType.ANNOUNCE_NUMBER,
        value: message.options.findIndex((option) => Number(option) === quantas),
      };
    }
    if (message.type === OcgMessageType.SORT_CARD) {
      mostradas = message.cards.map((card) => card.code);
      return responder(message);
    }
    return null;
  });
  const deck = duel
    .query(0, OcgLocation.DECK)
    .filter((card) => card?.code)
    .map((card) => card.code)
    .reverse();
  duel.destroy();
  return { mostradas, deck, desfecho };
}

const pelaTela = (ordem) => (message) => buildPromptPlan(message).sorting.build(ordem);

console.log("Ordem escolhida na tela (3 cartas, permutação cíclica)");
{
  // A tela pensa "o que fica em cada posição": a carta 2 no topo, depois a 0,
  // depois a 1.
  const { mostradas, deck, desfecho } = await ordenar(3, pelaTela([2, 0, 1]));
  conferir(desfecho === "STOPPED", "o core aceitou a resposta", desfecho);
  const esperado = mostradas ? [mostradas[2], mostradas[0], mostradas[1]] : [];
  conferir(
    JSON.stringify(deck.slice(0, 3)) === JSON.stringify(esperado),
    "o topo do Deck ficou na ordem escolhida",
    `topo ${deck.slice(0, 3)} × escolhido ${esperado}`,
  );
}

console.log("\nOutras ordens");
{
  const r = await ordenar(3, pelaTela([1, 2, 0]));
  conferir(
    r.desfecho === "STOPPED" && JSON.stringify(r.deck.slice(0, 3)) === JSON.stringify([r.mostradas[1], r.mostradas[2], r.mostradas[0]]),
    "[1, 2, 0] (o outro ciclo de 3)",
    `${r.desfecho} topo ${r.deck.slice(0, 3)}`,
  );
  const um = await ordenar(1, pelaTela([0]));
  conferir(um.desfecho === "STOPPED", "uma carta só: [0] é aceito (antes: RETRY para sempre)", um.desfecho);
  const manter = await ordenar(3, pelaTela(null));
  conferir(
    manter.desfecho === "STOPPED" && JSON.stringify(manter.deck.slice(0, 3)) === JSON.stringify(manter.mostradas),
    "\"Manter a ordem atual\" deixa como estava",
    `${manter.desfecho} topo ${manter.deck.slice(0, 3)}`,
  );
  const bot = await ordenar(5, botAutoResponse);
  conferir(
    bot.desfecho === "STOPPED" && JSON.stringify(bot.deck.slice(0, 5)) === JSON.stringify(bot.mostradas),
    "a resposta do bot (identidade, 5 cartas) é aceita",
    `${bot.desfecho}`,
  );
}

if (falhas.length) {
  console.log(`\n${falhas.length} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nOrdenação: tudo certo.");
}
