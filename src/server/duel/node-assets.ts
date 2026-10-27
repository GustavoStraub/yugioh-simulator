import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import createCore, { type OcgCoreSync } from "@n1xx1/ocgcore-wasm";

import type { DuelAssets } from "@/lib/duel/duel-assets";
import {
  EngineStringsDb,
  EMPTY_ENGINE_STRINGS,
  type EngineStringsData,
} from "@/lib/duel/engine-strings";
import { OfficialCardDb, type CardDb } from "@/lib/duel/official-card-data";
import { fetchCardScript } from "@/lib/duel/script-source";
import { nodeBotAnalysisTransport } from "@/server/duel/bot-analysis-transport";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * O binário do engine.
 *
 * `wasmBinary` em vez de `locateFile`: no Node não existe origem para resolver
 * `/ocgcore/...`, e o caminho alternativo (remendar `globalThis.fetch` para
 * entender `file://`, como o harness faz) mexe num global que o próprio Next
 * usa. Passar os bytes é mais direto e mais rápido — medido em 3 ms.
 */
const WASM_PATH = join(
  REPO,
  "node_modules/@n1xx1/ocgcore-wasm/lib/ocgcore.sync.wasm",
);

/**
 * Clone local do ProjectIgnis/CardScripts, quando existe.
 *
 * É o mesmo diretório que o harness usa (`npm run fixtures`). Quando está lá,
 * o duelo online sobe sem tocar a rede; quando não está, cai na mesma busca
 * que a rota `/api/scripts` faz para o navegador.
 */
const SCRIPTS_DIR = process.env.CARDSCRIPTS_DIR ?? join(REPO, ".cache/CardScripts");

/** Ordem de busca no clone — `pre-errata` tem versões antigas da mesma carta. */
const SCRIPT_DIRS = ["", "official", "goat", "pre-errata", "unofficial", "pre-release"];

function readLocalScript(name: string): string | null {
  if (!existsSync(SCRIPTS_DIR)) return null;

  const base = name.replace(/^official\//, "");
  for (const dir of SCRIPT_DIRS) {
    const path = join(SCRIPTS_DIR, dir, base);
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  return null;
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(REPO, relativePath), "utf8")) as T;
}

/**
 * Um core por processo.
 *
 * Instanciar o wasm custa alguns milissegundos, mas cada `createDuel` já é
 * isolado (o `cardReader`/`scriptReader` são fechamentos por duelo), então um
 * core serve todas as salas — verificado com três duelos simultâneos.
 */
let corePromise: Promise<OcgCoreSync> | null = null;
let cardDbCache: OfficialCardDb | null = null;
let engineStringsCache: EngineStringsDb | null = null;

export const nodeAssets: DuelAssets = {
  createBotWorker: nodeBotAnalysisTransport,
  loadCore(printErr) {
    corePromise ??= (async () => {
      const file = readFileSync(WASM_PATH);
      const core = await createCore({
        sync: true,
        // `Buffer` é uma view de um pool compartilhado: mandar `.buffer` cru
        // entregaria memória de outros alocamentos junto.
        wasmBinary: file.buffer.slice(
          file.byteOffset,
          file.byteOffset + file.byteLength,
        ) as ArrayBuffer,
        printErr,
      });
      return core as OcgCoreSync;
    })();
    return corePromise;
  },

  async fetchScript(path) {
    return readLocalScript(path) ?? (await fetchCardScript(path));
  },

  async cardDb() {
    cardDbCache ??= new OfficialCardDb(readJson<CardDb>("src/data/card-db.json"));
    return cardDbCache;
  },

  async engineStrings() {
    try {
      engineStringsCache ??= new EngineStringsDb(
        readJson<EngineStringsData>("src/data/engine-strings.json"),
      );
      return engineStringsCache;
    } catch {
      // Sem os textos o duelo roda igual — só o log fica mais pobre.
      return EMPTY_ENGINE_STRINGS;
    }
  },
};
