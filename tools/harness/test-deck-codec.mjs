/**
 * Importar e exportar deck: `.ydk` e `ydke://` (`deck-codec.ts`).
 *
 * São os formatos que os outros simuladores e os sites de deck usam. Um erro
 * aqui não quebra nada na tela — o deck simplesmente chega diferente do que
 * saiu (uma cópia a menos, uma carta no Extra que era do Side), e ninguém
 * percebe até a partida. Por isso: vetor conhecido, ida e volta, e os
 * arquivos "sujos" que circulam por aí (CRLF, comentário, nome depois do
 * passcode).
 *
 * Uso: npm run test:deck-codec
 */
import {
  deckZones,
  exportYdk,
  exportYdke,
  importDeckLists,
  parseDeckText,
  parseYdk,
  parseYdke,
} from "@/lib/domain/deck-codec";

const falhas = [];
function conferir(condicao, descricao, detalhe = "") {
  console.log(condicao ? `  ✓ ${descricao}` : `  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!condicao) falhas.push(descricao);
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const DM = 46986414; // Dark Magician
const BLS = 72989439;
const deck = {
  id: "x",
  name: "Teste",
  format: "goat",
  main: [{ passcode: DM, quantity: 3 }, { passcode: BLS, quantity: 1 }],
  extra: [{ passcode: 40737112, quantity: 2 }],
  side: [{ passcode: 5318639, quantity: 1 }],
  updatedAt: "2026-01-01T00:00:00.000Z",
};

console.log("ydke://");
conferir(igual(parseYdke("ydke://rvTMAg==!!!").main, [DM]), "vetor conhecido: Dark Magician = rvTMAg==");
const link = exportYdke(deck);
conferir(link.startsWith("ydke://") && link.endsWith("!"), "exporta no formato ydke://p!e!s!", link);
const volta = parseYdke(link);
conferir(igual({ main: volta.main, extra: volta.extra, side: volta.side }, deckZones(deck)), "ida e volta mantém zonas e cópias");
conferir(parseYdke("https://exemplo.com").errors.length > 0, "texto que não é ydke:// vira erro, não deck vazio silencioso");
conferir(parseYdke("ydke://@@@!!!").errors.length > 0, "base64 inválido vira erro");

console.log(".ydk");
const ydk = exportYdk(deck);
conferir(/#main[\s\S]*#extra[\s\S]*!side/.test(ydk), "tem #main, #extra e !side na ordem");
const lido = parseYdk(ydk);
conferir(igual({ main: lido.main, extra: lido.extra, side: lido.side }, deckZones(deck)), "ida e volta mantém zonas e cópias");
const sujo = parseYdk(
  "#created by alguém\r\n#main\r\n46986414 Dark Magician\r\n\r\n46986414\r\n#extra\r\n40737112\r\n!side\r\n5318639\r\nlixo\r\n",
);
conferir(igual(sujo.main, [DM, DM]) && igual(sujo.extra, [40737112]) && igual(sujo.side, [5318639]), "CRLF, comentário e nome depois do passcode");
conferir(sujo.errors.length === 1 && sujo.errors[0].includes("lixo"), "a linha ilegível é reportada", JSON.stringify(sujo.errors));

console.log("detecção e catálogo");
conferir(igual(parseDeckText("  ydke://rvTMAg==!!!").main, [DM]), "parseDeckText reconhece ydke:// pelo conteúdo");
conferir(igual(parseDeckText("#main\n46986414\n").main, [DM]), "e .ydk pelo resto");
const importado = importDeckLists({ main: [DM, DM, 999, DM], extra: [], side: [] }, (code) => code !== 999);
conferir(
  igual(importado.main, [{ passcode: DM, quantity: 3 }]) && igual(importado.unknown, [999]),
  "cópias agrupadas; passcode desconhecido fica de fora e é contado",
  JSON.stringify(importado),
);

console.log(falhas.length === 0 ? "\nImportar/exportar deck: tudo certo." : `\nFALHOU (${falhas.length}): ${falhas.join("; ")}`);
process.exit(falhas.length === 0 ? 0 : 1);
