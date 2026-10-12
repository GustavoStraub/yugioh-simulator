import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(
  root,
  "node_modules/@n1xx1/ocgcore-wasm/lib/ocgcore.sync.wasm",
);
const targetDir = join(root, "public/ocgcore");
const target = join(targetDir, "ocgcore.sync.wasm");

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
console.log("Copied ocgcore.sync.wasm to public/ocgcore/");

const modJsPath = join(root, "node_modules/@n1xx1/ocgcore-wasm/mod.js");
const modJsSource = readFileSync(modJsPath, "utf-8");
if (!modJsSource.includes("export { default }")) {
  writeFileSync(
    modJsPath,
    'export * from "./dist/index.js";\nexport { default } from "./dist/index.js";\n',
  );
  console.log("Patched @n1xx1/ocgcore-wasm mod.js default export");
}

const modDtsPath = join(root, "node_modules/@n1xx1/ocgcore-wasm/_dist/mod.d.ts");
writeFileSync(
  modDtsPath,
  'export * from "../dist/index.d.ts";\nexport { default } from "../dist/index.d.ts";\n',
);
console.log("Patched @n1xx1/ocgcore-wasm mod.d.ts default export");

/*
 * Resposta de SORT_CARD / SORT_CHAIN: o binding escreve a quantidade antes da
 * ordem (`[n, o0, o1, …]`), mas o core lê a ordem direto do byte 0 — para cada
 * uma das `m` cartas, `returns.at<int8_t>(i)` tem de ser uma posição `< m` e
 * sem repetir (`field::sort_card`). Com o byte a mais, toda ordem explícita
 * chega deslocada: `[0]` para uma carta só vira `[1, 0]`, posição 1 de 1, e o
 * core responde RETRY para sempre. Só `order: null` (o `-1` de "manter a
 * ordem") passava. Na tela, quem reordenava as cartas do topo do deck travava
 * o duelo; contra o bot, o duelo era interrompido depois de 5 RETRY.
 *
 * O conserto tira só a escrita do tamanho. Se a âncora não for encontrada, o
 * aviso sai alto: ou o binding mudou (conferir se o bug continua — o
 * `test:prompt-rules` cobre), ou alguém já corrigiu lá.
 */
const indexJsPath = join(root, "node_modules/@n1xx1/ocgcore-wasm/dist/index.js");
const indexJs = readFileSync(indexJsPath, "utf-8");
const SORT_BUG = "if(!e.order){t.i8(-1);break}t.i8(e.order.length);for(let r of e.order)t.i8(r);break;";
const SORT_FIX = "if(!e.order){t.i8(-1);break}for(let r of e.order)t.i8(r);break;";
if (indexJs.includes(SORT_BUG)) {
  writeFileSync(indexJsPath, indexJs.replace(SORT_BUG, SORT_FIX));
  console.log("Patched @n1xx1/ocgcore-wasm SORT_CARD response (sem o byte de tamanho)");
} else if (indexJs.includes(SORT_FIX)) {
  console.log("@n1xx1/ocgcore-wasm SORT_CARD response já corrigida");
} else {
  console.warn(
    "⚠ @n1xx1/ocgcore-wasm: âncora da resposta SORT_CARD não encontrada — " +
      "conferir se o binding ainda escreve o tamanho antes da ordem (test:prompt-rules).",
  );
}
