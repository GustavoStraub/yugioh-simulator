/**
 * Testa cartas do pool Goat contra a engine de verdade.
 *
 * Duas perguntas por carta:
 *  1. **O script carrega?** — `initial_effect` roda sem estourar em Lua. Uma
 *     falha aqui deixa a carta inerte no duelo sem nenhum aviso na tela.
 *  2. **Dá para ativar/invocar?** — a carta aparece entre as ações que o core
 *     oferece no Main Phase 1. É o que o jogador chama de "o efeito funciona".
 *
 * O tabuleiro do teste é propositalmente farto (monstros dos dois lados, cartas
 * no cemitério, deck cheio): a maioria dos efeitos tem condição, e num campo
 * vazio quase tudo daria "não ativável" por motivo legítimo, escondendo os
 * casos realmente quebrados. O cenário e o veredito moram em `card-scan.mjs`,
 * compartilhados com a bateria do pool TCG (`test-tcg-pool.mjs`).
 *
 * Uso:
 *   node tools/harness/test-cards.mjs                 # o pool inteiro
 *   node tools/harness/test-cards.mjs --slice 0/8     # fatia 0 de 8
 *   node tools/harness/test-cards.mjs 12345 67890     # passcodes específicos
 *   node tools/harness/test-cards.mjs --json out.json # relatório em JSON
 */
import { writeFileSync } from "node:fs";

import { applySlice, parseScanArgs, printScanSummary, runScan } from "./card-scan.mjs";
import { loadCardDb, loadGoatPool } from "./env.mjs";

async function main() {
  const args = parseScanArgs(process.argv.slice(2));

  const db = loadCardDb();
  const pool = loadGoatPool();
  let cards = pool;
  if (args.explicit.length) {
    const known = new Map(pool.map((c) => [c.id, c]));
    // Passcodes fora do pool Goat ainda são testáveis: o banco oficial tem os
    // dados, e é justamente aí que moram as artes alternativas.
    cards = args.explicit.map((id) => known.get(id) ?? { id, name: `#${id}`, type: "?" });
  }
  cards = applySlice(cards, args.slice);

  const report = await runScan(cards, db);
  printScanSummary(report, { verbose: args.verbose });

  if (args.jsonOut) {
    writeFileSync(args.jsonOut, JSON.stringify(report, null, 1));
    process.stdout.write(`\nrelatório em ${args.jsonOut}\n`);
  }
}

await main();
