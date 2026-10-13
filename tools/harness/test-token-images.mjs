/**
 * Toda ficha que o engine pode criar aparece na mesa com nome e imagem?
 *
 * As fichas são o ponto cego do catálogo: a lista da YGOPRODeck (`type=token`)
 * tem ~110 das ~240 que existem no banco oficial, e ~30 das que existem lá não
 * têm arte. Ficha sem definição entrava na mesa como imagem quebrada com o
 * nome "Carta"; ficha sem arte, como imagem quebrada com o nome certo.
 *
 * O que se confere:
 *
 * 1. cada ficha do `card-db.json` tem definição no catálogo, com nome;
 * 2. cada uma resolve para uma imagem: a arte da YGOPRODeck já no disco, ou a
 *    marca "a YGOPRODeck não tem" — e aí a face desenhada (`fallbackCardSvg`)
 *    sai válida e com o nome dela;
 * 3. a face escapa nome com `&`, `<`, aspas (SVG inválido = imagem quebrada);
 * 4. com `APP_URL`, as duas imagens (uma arte de verdade, uma face desenhada)
 *    carregam pela rota de verdade num Chrome, e a foto da face vai para
 *    `.cache/shots/ficha-sem-arte.png`.
 *
 * Uso:
 *   npm run test:token-images
 *   APP_URL=http://127.0.0.1:3100 npm run test:token-images
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { CardRegistry } from "@/lib/domain/card-registry";
import { CARD_IMAGES_DIR, fallbackCardSvg } from "@/server/catalog/card-images";

import { launchChrome, openPage } from "./browser.mjs";
import { REPO } from "./env.mjs";

const TYPE_TOKEN = 0x4000;

const falhas = [];
function conferir(condicao, descricao, detalhe = "") {
  console.log(condicao ? `  ✓ ${descricao}` : `  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!condicao) falhas.push(descricao);
}

const db = JSON.parse(readFileSync(join(REPO, "src/data/card-db.json"), "utf8"));
const registry = CardRegistry.fromCatalog(
  JSON.parse(readFileSync(join(REPO, ".cache/catalog/catalog.json"), "utf8")),
);
const fichas = Object.entries(db)
  .filter(([, row]) => row[0] & TYPE_TOKEN)
  .map(([id]) => Number(id));

console.log(`─── ${fichas.length} fichas no banco oficial ───`);

const semDefinicao = fichas.filter((id) => !registry.get(id)?.name);
conferir(semDefinicao.length === 0, "toda ficha tem definição com nome no catálogo", semDefinicao.slice(0, 10).join(", "));

let comArte = 0;
let desenhadas = 0;
const semResolucao = [];
const facesRuins = [];
let exemploSemArte = null;
let exemploComArte = null;
for (const id of fichas) {
  const def = registry.get(id);
  if (!def) continue;
  const imagem = def.images[0].id;
  if (existsSync(join(CARD_IMAGES_DIR, "small", `${imagem}.jpg`))) {
    comArte += 1;
    exemploComArte ??= imagem;
  } else if (existsSync(join(CARD_IMAGES_DIR, "small", `${imagem}.missing`))) {
    desenhadas += 1;
    exemploSemArte ??= imagem;
    const svg = fallbackCardSvg(def, imagem);
    // Palavra por palavra: nome longo quebra em duas linhas da face.
    const palavras = def.name
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .split(" ");
    if (!svg.startsWith("<svg") || !svg.trimEnd().endsWith("</svg>") || !palavras.every((p) => svg.includes(p))) {
      facesRuins.push(id);
    }
  } else {
    semResolucao.push(id);
  }
}
console.log(`  arte da YGOPRODeck: ${comArte} | face desenhada: ${desenhadas}`);
conferir(
  semResolucao.length === 0,
  "toda ficha resolve para arte ou face desenhada",
  `${semResolucao.length} sem verificação (rode \`npm run sync:images\`): ${semResolucao.slice(0, 10).join(", ")}`,
);
conferir(facesRuins.length === 0, "as faces desenhadas saem válidas e com o nome", facesRuins.join(", "));

{
  const svg = fallbackCardSvg(
    { name: `A & B <C> "D" 'E'`, frameType: "token", type: "Token", level: 4, atk: 1000, def: 1000 },
    1,
  );
  conferir(
    svg.includes("A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;") && !svg.includes("<C>"),
    "nome com & < > e aspas é escapado no SVG",
  );
}

if (process.env.APP_URL && exemploSemArte && exemploComArte) {
  console.log("\n─── Pela rota, num Chrome ───");
  const { child, port } = await launchChrome({ headless: true });
  try {
    const page = await openPage(port);
    await page.goto(`${process.env.APP_URL}/card-images/small/${exemploComArte}.jpg`);
    const medir = (id) =>
      page.evaluate(`
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => resolve({ ok: false });
          img.src = "/card-images/small/${id}.jpg?t=" + Date.now();
        });
      `);
    const real = await medir(exemploComArte);
    const desenhada = await medir(exemploSemArte);
    conferir(real.ok && real.w > 0, `arte de verdade carrega (${exemploComArte}: ${real.w}×${real.h})`);
    conferir(
      desenhada.ok && desenhada.w > 0,
      `face desenhada carrega no lugar da imagem quebrada (${exemploSemArte}: ${desenhada.w}×${desenhada.h})`,
    );

    // Foto da face, do tamanho de uma carta da mesa ampliada, para ver.
    await page.goto(`${process.env.APP_URL}/card-images/full/${exemploSemArte}.jpg`);
    const { data } = await page.screenshot();
    const foto = join(REPO, ".cache/shots/ficha-sem-arte.png");
    mkdirSync(dirname(foto), { recursive: true });
    writeFileSync(foto, Buffer.from(data, "base64"));
    console.log(`  foto: ${foto}`);
  } finally {
    child.kill();
  }
}

if (falhas.length) {
  console.log(`\n${falhas.length} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nFichas: todas com nome e imagem.");
}
