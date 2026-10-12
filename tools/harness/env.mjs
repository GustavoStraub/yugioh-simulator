/**
 * Ambiente headless para rodar o ocgcore fora do navegador.
 *
 * O binding do ocgcore-wasm foi feito para a web: ele carrega o .wasm com
 * `fetch`, e o app carrega scripts Lua e o banco de cartas por HTTP. Aqui nada
 * disso existe, então este módulo dá ao core as mesmas peças a partir do disco
 * — é o que permite testar as cartas sem abrir o navegador.
 */
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Importado por caminho relativo, não pelo atalho `@/...`: o harness roda no
// Node puro, sem o resolvedor de caminhos do bundler.
import { patchCoreScript } from "../../src/lib/duel/script-patches.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = join(here, "../..");

/** Onde o clone do ProjectIgnis/CardScripts fica. */
export const SCRIPTS_DIR =
  process.env.CARDSCRIPTS_DIR ?? join(REPO, ".cache/CardScripts");

/** `fetch` do Node não abre `file://`; o loader do wasm depende disso. */
export function installFileFetch() {
  if (globalThis.__ygoFileFetchInstalled) return;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input?.url ?? String(input));
    if (url.startsWith("file://")) {
      const body = await readFile(fileURLToPath(url));
      // O tipo importa: sem ele o `instantiateStreaming` recusa o módulo e o
      // loader cai no caminho lento, poluindo o log com um erro que não é um.
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/wasm" },
      });
    }
    return realFetch(input, init);
  };
  globalThis.__ygoFileFetchInstalled = true;
}

export async function loadCore(onPrint) {
  installFileFetch();
  const createCore = (await import("@n1xx1/ocgcore-wasm")).default;
  return createCore({
    sync: true,
    locateFile: (file) =>
      pathToFileURL(join(REPO, "node_modules/@n1xx1/ocgcore-wasm/lib", file)).href,
    printErr: (message) => onPrint?.(message),
  });
}

/**
 * Localiza um script Lua no clone.
 *
 * O repositório separa `official/` (o pool que o jogo usa) de `pre-errata/`,
 * `unofficial/` e afins; a raiz guarda os utilitários. Procurar na ordem certa
 * importa: `pre-errata` tem versões antigas da mesma carta.
 */
const SCRIPT_DIRS = ["", "official", "goat", "pre-errata", "unofficial", "pre-release"];

export function readScriptFile(name) {
  const base = name.replace(/^official\//, "");
  for (const dir of SCRIPT_DIRS) {
    const path = join(SCRIPTS_DIR, dir, base);
    if (existsSync(path)) {
      const raw = readFileSync(path, "utf8");
      // As mesmas emendas que o app aplica — se o harness lesse o script cru,
      // ele testaria um jogo diferente do que o jogador joga. O escape existe
      // só para diagnóstico: com as emendas desligadas dá para ver o erro
      // original que elas escondem.
      if (process.env.SKIP_SCRIPT_PATCHES === "1") return raw;
      return patchCoreScript(base, raw);
    }
  }
  return null;
}

/** Índice do banco oficial gerado por `scripts/build-card-db.mjs`. */
const CARD_DB_FIELDS = ["type","alias","level","race","attribute","atk","def","lscale","rscale"];
export const CARD_ARTWORK_VERSIONS_OFFSET = 20;

let cardDbCache = null;
export function loadCardDb() {
  if (cardDbCache) return cardDbCache;
  const rows = JSON.parse(readFileSync(join(REPO, "src/data/card-db.json"), "utf8"));

  const decode = (row) => {
    const data = {};
    CARD_DB_FIELDS.forEach((field, index) => (data[field] = row[index] ?? 0));
    data.setcodes = row.slice(CARD_DB_FIELDS.length);
    return data;
  };

  const get = (passcode) => {
    const direct = rows[String(passcode)];
    if (direct) return decode(direct);
    for (let back = 1; back < CARD_ARTWORK_VERSIONS_OFFSET; back += 1) {
      const row = rows[String(passcode - back)];
      if (!row) continue;
      const original = decode(row);
      if (original.alias === 0 || original.alias === passcode - back) {
        return { ...original, alias: passcode - back };
      }
      return null;
    }
    return null;
  };

  const scriptPasscode = (passcode) => {
    const data = get(passcode);
    if (!data || data.alias === 0) return passcode;
    return Math.abs(data.alias - passcode) < CARD_ARTWORK_VERSIONS_OFFSET
      ? data.alias
      : passcode;
  };

  cardDbCache = { rows, get, scriptPasscode };
  return cardDbCache;
}

/** Pool do formato Goat, como a YGOPRODeck devolve (baixado por `sync-fixtures`). */
export function loadGoatPool() {
  const path = join(REPO, ".cache/goat-pool.json");
  if (!existsSync(path)) {
    throw new Error(
      "Falta .cache/goat-pool.json — rode `node tools/harness/sync-fixtures.mjs`.",
    );
  }
  return JSON.parse(readFileSync(path, "utf8")).data;
}
