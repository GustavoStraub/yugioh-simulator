/**
 * As regras que a tela copia do core — conferidas caso a caso.
 *
 * Três prompts têm regra própria que a tela PRECISA espelhar, porque é ela que
 * habilita o "Confirmar": se a conta da tela for mais frouxa que a do core, o
 * jogador confirma e recebe "resposta inválida"; se for mais rígida, ele não
 * consegue confirmar uma escolha legal. As duas coisas aparecem como "a carta
 * não funciona".
 *
 * - **ANNOUNCE_CARD** — `isDeclarable` (espelho de `is_declarable` do
 *   ygopro-core): arquétipo com sub-arquétipo, alias e fichas só com flag.
 * - **SELECT_SUM** — soma exata × "igual ou maior sem carta sobrando", e carta
 *   de dois valores.
 * - **SELECT_COUNTER** — distribuir N marcadores, cada carta até o que tem.
 *
 * Os casos de duelo (que o core aceita ou recusa de verdade) estão nos outros
 * testes; este prende a conta em si, rápido e sem engine.
 *
 * Uso: npm run test:prompt-rules
 */
import { OcgMessageType, OcgOpCode } from "@n1xx1/ocgcore-wasm";

import { isDeclarable } from "@/lib/duel/announce-filter";
import { autoResponseFor } from "@/lib/duel/auto-response";
import { buildPromptPlan } from "@/lib/duel/duel-actions";
import { findSumSubset, isValidSum } from "@/lib/duel/sum-selection";

import { loadCardDb } from "./env.mjs";

const falhas = [];
function conferir(condicao, descricao, detalhe = "") {
  if (condicao) {
    console.log(`  ✓ ${descricao}`);
  } else {
    falhas.push(descricao);
    console.log(`  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

const db = loadCardDb();
const dados = (code) => ({ code, ...db.get(code) });

// ---------------------------------------------------------------------------
console.log("ANNOUNCE_CARD — o filtro do core");
{
  const ANCIENT_GEAR_GADGET = 18486927;
  // O filtro do próprio script (`s.announce_filter`): um monstro "Gadget" que
  // não seja ele mesmo.
  const gadget = [
    0x51n, OcgOpCode.ISSETCARD,
    BigInt(ANCIENT_GEAR_GADGET), OcgOpCode.ISCODE, OcgOpCode.NOT, OcgOpCode.AND,
    0x1n, OcgOpCode.ISTYPE, OcgOpCode.AND,
  ];
  conferir(isDeclarable(gadget, dados(41172955)), "Green Gadget passa no filtro 'Gadget'");
  conferir(!isDeclarable(gadget, dados(ANCIENT_GEAR_GADGET)), "o próprio Ancient Gear Gadget não passa (ISCODE + NOT)");
  conferir(!isDeclarable(gadget, dados(46986414)), "Dark Magician não passa");
  conferir(!isDeclarable(gadget, dados(8025950)), "Gadget Box (Magia) não passa (precisa ser monstro)");

  // O que `Duel.AnnounceCard(tp)` sem filtro manda: "qualquer Monstro, Magia
  // ou Armadilha" (libduel.cpp).
  const qualquer = [0x1n | 0x2n | 0x4n, OcgOpCode.ISTYPE];
  conferir(isDeclarable(qualquer, dados(46986414)), "sem filtro: o Dark Magician original é declarável");
  conferir(!isDeclarable(qualquer, dados(46986420)), "uma ARTE alternativa não é (declara-se o nome, não a arte)");
  conferir(
    isDeclarable([...qualquer, OcgOpCode.ALLOW_ALIASES], dados(46986420)),
    "…a não ser com ALLOW_ALIASES",
  );
  conferir(!isDeclarable(qualquer, dados(645088)), "uma ficha não é declarável");
  conferir(isDeclarable([...qualquer, OcgOpCode.ALLOW_TOKENS], dados(645088)), "…a não ser com ALLOW_TOKENS");
  conferir(isDeclarable(qualquer, dados(78734254)), "Marine Dolphin sempre é (exceção do core), mesmo com alias");
  conferir(!isDeclarable([], dados(46986414)), "pilha vazia não declara nada (como no core)");
  conferir(
    isDeclarable([0x1n, OcgOpCode.ISTYPE, 0x40n, OcgOpCode.ISTYPE, OcgOpCode.NOT, OcgOpCode.AND], dados(46986414)),
    "monstro que não é Fusion: Dark Magician passa",
  );
}

// ---------------------------------------------------------------------------
console.log("\nSELECT_SUM — soma exata, igual ou maior, carta de dois valores");
{
  const carta = (amount) => ({ code: 1, controller: 0, location: 4, sequence: 0, amount });
  const exata = (amount, valores, min = 1, max = 99) => ({
    amount, mode: "exact", min, max, selects: valores.map(carta), selectsMust: [],
  });
  const maior = (amount, valores) => ({
    amount, mode: "atLeast", min: 0, max: 0, selects: valores.map(carta), selectsMust: [],
  });

  // Mais de 16 candidatos (efeito que olha o Deck inteiro): a busca não pode
  // virar "os maiores primeiro". Speedroid Wheel com o dado em 1, no deck
  // Speedroid do Legendary Arc-V: só o Nível 1 serve.
  {
    const wheel = exata(1, [4, 4, 2, 3, 3, 3, 3, 3, 3, 5, 4, 2, 5, 3, 1, 2, 3, 3, 3], 1, 2);
    const r = findSumSubset(wheel);
    conferir(JSON.stringify(r) === "[14]" && isValidSum(wheel, r), "19 candidatos, soma exata 1: escolhe o Nível 1", JSON.stringify(r));
    const dois = exata(7, Array.from({ length: 20 }, (_, i) => (i === 6 ? 3 : i === 13 ? 4 : 8 + (i % 3))), 1, 2);
    const r2 = findSumSubset(dois);
    conferir(isValidSum(dois, r2) && r2.length === 2, "20 candidatos, soma exata 7 com duas cartas (3 + 4)", JSON.stringify(r2));
    const ritual = maior(8, Array.from({ length: 18 }, (_, i) => 1 + (i % 4)));
    const r3 = findSumSubset(ritual);
    conferir(isValidSum(ritual, r3), "18 candidatos, igual ou maior que 8 sem carta sobrando", JSON.stringify(r3));
  }

  conferir(isValidSum(exata(8, [4, 4, 3]), [0, 1]), "exata: 4+4 = 8 vale");
  conferir(!isValidSum(exata(8, [4, 4, 3]), [0, 2]), "exata: 4+3 = 7 não vale");
  conferir(!isValidSum(exata(8, [4, 4, 3]), [0, 1, 2]), "exata: 4+4+3 = 11 não vale (passar não pode)");
  conferir(!isValidSum(exata(8, [4, 4, 3], 3, 3), [0, 1]), "exata: respeita a quantidade mínima de cartas");
  const dupla = 4 | (8 << 16); // vale 4 OU 8
  conferir(isValidSum(exata(8, [dupla]), [0]), "dois valores: sozinha vale 8");
  conferir(isValidSum(exata(8, [dupla, 4]), [0, 1]), "dois valores: 4+4 também");
  conferir(isValidSum(exata(12, [dupla, 4]), [0, 1]), "dois valores: 8+4 = 12");
  conferir(!isValidSum(exata(10, [dupla, 4]), [0, 1]), "dois valores: 10 não sai de 4/8 + 4");

  conferir(isValidSum(maior(8, [4, 4, 1]), [0, 1]), "igual ou maior: 4+4");
  conferir(!isValidSum(maior(8, [4, 4, 1]), [0, 1, 2]), "igual ou maior: 4+4+1 tem carta sobrando");
  conferir(!isValidSum(maior(8, [8, 1]), [0, 1]), "igual ou maior: 8+1 tem carta sobrando");
  conferir(isValidSum(maior(8, [6, 3]), [0, 1]), "igual ou maior: 6+3 = 9 vale (nenhuma sobra)");
  conferir(!isValidSum(maior(8, [6, 1]), [0, 1]), "igual ou maior: 7 não chega");

  const achou = findSumSubset(exata(8, [3, 4, 5, 4]));
  conferir(isValidSum(exata(8, [3, 4, 5, 4]), achou) && achou.length === 2, "o bot acha uma soma exata válida e curta", JSON.stringify(achou));
}

// ---------------------------------------------------------------------------
console.log("\nSELECT_COUNTER — distribuir marcadores");
{
  const mensagem = (count, contagens) => ({
    type: OcgMessageType.SELECT_COUNTER,
    player: 0,
    counter_type: 1,
    count,
    cards: contagens.map((n, sequence) => ({ code: 71413901, controller: 0, location: 4, sequence, count: n })),
  });
  const plano = buildPromptPlan(mensagem(3, [2, 2]));
  conferir(plano.counters?.count === 3, "o plano pede 3 marcadores");
  conferir(plano.counters?.cards.map((c) => c.max).join(",") === "2,2", "cada carta até o que tem");
  conferir(
    JSON.stringify(plano.counters?.build([2, 1])) === JSON.stringify({ type: 13, counters: [2, 1] }),
    "a resposta leva quanto sai de cada carta",
  );
  conferir(autoResponseFor(mensagem(3, [2, 2])) === null, "com escolha de verdade, não responde sozinho");
  conferir(
    JSON.stringify(autoResponseFor(mensagem(4, [2, 2]))?.counters) === "[2,2]",
    "tirar TODOS os marcadores responde sozinho",
  );
}

if (falhas.length) {
  console.log(`\n${falhas.length} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nRegras dos prompts: tudo certo.");
}
