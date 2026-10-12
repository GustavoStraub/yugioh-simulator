/**
 * Baixa de antemão as imagens pequenas das cartas para `.cache/card-images/`.
 *
 * Opcional: a rota `/card-images/...` já baixa cada imagem na primeira vez que
 * alguém a pede e guarda em disco. Este script faz isso de uma vez, para
 * nenhuma imagem precisar ir à YGOPRODeck no meio de um duelo ou de uma busca
 * no construtor — útil antes de publicar o jogo (`npm run public`).
 *
 * Respeita a mesma fila de ~14 requisições por segundo da rota (a YGOPRODeck
 * bloqueia por uma hora quem passa de 20/s). A fila é por PROCESSO: com o
 * servidor também baixando imagens ao mesmo tempo (alguém navegando o
 * construtor numa máquina sem cache), as duas filas somam — rode com o jogo
 * parado, ou sem ninguém usando. As ~14 mil imagens pequenas
 * levam por volta de 17 minutos e ocupam algumas centenas de MB; o que já
 * está em disco é pulado, então dá para interromper e retomar.
 *
 * Uso:
 *   npm run sync:images                # cartas jogáveis (pool TCG + Goat)
 *   npm run sync:images -- --goat      # só o pool Goat
 *   npm run sync:images -- --full      # também as imagens grandes
 */
import { decodeCatalogRow } from "@/lib/catalog/catalog-format";
import { loadCatalog } from "@/server/catalog/catalog-store";
import { cardImage, hasCardImage } from "@/server/catalog/card-images";

const goat = process.argv.includes("--goat");
const sizes = process.argv.includes("--full") ? ["small", "full"] : ["small"];

const catalog = await loadCatalog();
const cards = catalog.cards
  .map(decodeCatalogRow)
  .filter((card) => (goat ? card.goat : card.playable || card.goat));

const tarefas = [];
for (const size of sizes) {
  for (const card of cards) {
    if (!hasCardImage(size, card.id)) tarefas.push({ size, id: card.id });
  }
}

process.stdout.write(
  `${cards.length} cartas; ${tarefas.length} imagem(ns) a baixar (${sizes.join(" + ")}).\n`,
);

let feitas = 0;
let faltando = 0;
let falhas = 0;
// Algumas em paralelo: a fila de `card-images.ts` é quem dita o ritmo.
const PARALELO = 8;
let cursor = 0;
async function trabalhador() {
  while (cursor < tarefas.length) {
    const tarefa = tarefas[cursor];
    cursor += 1;
    try {
      const bytes = await cardImage(tarefa.size, tarefa.id);
      if (bytes) feitas += 1;
      else faltando += 1;
    } catch {
      falhas += 1;
    }
    const total = feitas + faltando + falhas;
    if (total % 250 === 0) process.stdout.write(`  ${total}/${tarefas.length}\n`);
  }
}
await Promise.all(Array.from({ length: PARALELO }, trabalhador));

process.stdout.write(
  `pronto: ${feitas} baixada(s), ${faltando} sem imagem na YGOPRODeck, ${falhas} falha(s).\n`,
);
if (falhas > 0) process.exitCode = 1;
