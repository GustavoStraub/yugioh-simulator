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

/*
 * Consulta COUNTERS: o core manda cada contador como um u32 `tipo | (qtd << 16)`
 * (`card::get_infos`), ou seja, em little-endian o 1º u16 é o TIPO e o 2º a
 * QUANTIDADE. O binding lê os dois na ordem certa e grava ao contrário —
 * `counters[qtd] = tipo`. A mesa recebia `{ 1: 27 }` para 1 Marcador de
 * Relógio (tipo 0x1b) e mostrava "✦27" desde o primeiro marcador. O Marcador
 * de Magia (tipo 0x1) com 1 unidade é o único caso em que a troca não aparece,
 * e era justo o que o `test:marks` usava. Pior que o número errado: indexar
 * pela quantidade faz dois tipos com a mesma contagem se sobrescreverem.
 *
 * O conserto só troca chave e valor. A narração (`ADD_COUNTER`/
 * `REMOVE_COUNTER`) vem por outro parse, que já estava certo.
 */
const indexJsContadores = readFileSync(indexJsPath, "utf-8");
const COUNTERS_BUG = "let c=e.u16(),a=e.u16();t.counters[a]=c}";
const COUNTERS_FIX = "let c=e.u16(),a=e.u16();t.counters[c]=a}";
if (indexJsContadores.includes(COUNTERS_BUG)) {
  writeFileSync(indexJsPath, indexJsContadores.replace(COUNTERS_BUG, COUNTERS_FIX));
  console.log("Patched @n1xx1/ocgcore-wasm: consulta COUNTERS indexada pelo tipo, não pela quantidade");
} else if (indexJsContadores.includes(COUNTERS_FIX)) {
  console.log("@n1xx1/ocgcore-wasm: consulta COUNTERS já corrigida");
} else {
  console.warn(
    "⚠ @n1xx1/ocgcore-wasm: âncora da consulta COUNTERS não encontrada — " +
      "conferir se tipo e quantidade do contador ainda vêm trocados (test:marks, Clock Tower Prison).",
  );
}

/*
 * Mensagem que o binding não sabe desserializar: ele lança ("Error: eof") e
 * o lote INTEIRO daquele passo do core se perde — junto com as mensagens boas
 * que vinham no mesmo lote (dano, movimento, dica de carta, log). Visto ~1 vez
 * a cada 19 duelos TCG (bateria em massa da Fase 9), sempre recuperado pelo
 * laço, mas com a narração e os eventos daquele passo sumindo.
 *
 * Cada mensagem já vem com o próprio tamanho na frente, então a leitura de
 * fora não desalinha: só o parse de DENTRO falha. O conserto embrulha esse
 * parse e cai no ramo que o binding já tem para mensagem desconhecida (aviso
 * no console e segue) — perde-se só a mensagem ruim.
 */
const indexJsAtual = readFileSync(indexJsPath, "utf-8");
const PARSE_BUG = "R=te(T);if(!R){T.reset(),console.warn(";
const PARSE_FIX = "R=(()=>{try{return te(T)}catch{return null}})();if(!R){T.reset(),console.warn(";
if (indexJsAtual.includes(PARSE_BUG)) {
  writeFileSync(indexJsPath, indexJsAtual.replace(PARSE_BUG, PARSE_FIX));
  console.log("Patched @n1xx1/ocgcore-wasm: mensagem ilegível não derruba mais o lote inteiro");
} else if (indexJsAtual.includes(PARSE_FIX)) {
  console.log("@n1xx1/ocgcore-wasm: parse por mensagem já protegido");
} else {
  console.warn(
    "⚠ @n1xx1/ocgcore-wasm: âncora do parse de mensagens não encontrada — " +
      "um `eof` volta a derrubar o lote inteiro (conferir test:presets em massa).",
  );
}
