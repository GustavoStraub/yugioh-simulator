/**
 * Monta `.cache/catalog/catalog.json` — o catálogo enxuto de todas as cartas
 * TCG (mais o pool Goat e as fichas), a partir da YGOPRODeck.
 *
 * O servidor monta sozinho na primeira requisição se o arquivo não existir;
 * este script existe para fazer isso de antemão (e para atualizar).
 *
 * Uso:
 *   npm run build:catalog               # usa as respostas já baixadas, se houver
 *   npm run build:catalog -- --refresh  # baixa tudo de novo
 */
import { buildCatalog, CATALOG_PATH } from "@/server/catalog/catalog-build";
import { decodeCatalogRow } from "@/lib/catalog/catalog-format";

const file = await buildCatalog({ refresh: process.argv.includes("--refresh") });
const cards = file.cards.map(decodeCatalogRow);
const count = (predicate) => cards.filter(predicate).length;

process.stdout.write(
  `catálogo ${file.version}: ${cards.length} cartas\n` +
    `  jogáveis (com dados oficiais): ${count((c) => c.playable)}\n` +
    `  sem dados oficiais (fora do construtor): ${count((c) => !c.playable)}\n` +
    `  pool Goat: ${count((c) => c.goat)}\n` +
    `  com texto em português: ${count((c) => c.descPt !== null)}\n` +
    `  na banlist TCG: ${count((c) => c.banTcg !== null)}\n` +
    `gravado em ${CATALOG_PATH}\n`,
);
