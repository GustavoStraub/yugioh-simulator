import createCore, { type OcgCoreSync } from "@n1xx1/ocgcore-wasm";

import type { DuelAssets } from "@/lib/duel/duel-assets";
import {
  EMPTY_ENGINE_STRINGS,
  fetchEngineStrings,
  type EngineStringsDb,
} from "@/lib/duel/engine-strings";
import {
  fetchOfficialCardDb,
  type OfficialCardDb,
} from "@/lib/duel/official-card-data";

/** Scripts já baixados nesta aba — não muda entre duelos. */
const SCRIPT_CACHE = new Map<string, string>();

/**
 * Memoização do que é caro de reprocessar.
 *
 * O HTTP já cacheia a resposta, mas o `JSON.parse` de ~14 mil cartas e do ~1 MB
 * de textos acontecia de novo a cada duelo iniciado.
 */
let cardDbPromise: Promise<OfficialCardDb> | null = null;
let engineStringsPromise: Promise<EngineStringsDb> | null = null;

function encodeScriptPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export const browserAssets: DuelAssets = {
  async loadCore(printErr) {
    const core = await createCore({
      sync: true,
      locateFile: (url) => `/ocgcore/${url}`,
      printErr,
    });
    return core as OcgCoreSync;
  },

  async fetchScript(path) {
    const cached = SCRIPT_CACHE.get(path);
    if (cached) return cached;

    try {
      const response = await fetch(`/api/scripts/${encodeScriptPath(path)}`);
      if (!response.ok) return null;
      const text = await response.text();
      SCRIPT_CACHE.set(path, text);
      return text;
    } catch {
      return null;
    }
  },

  cardDb() {
    cardDbPromise ??= fetchOfficialCardDb();
    return cardDbPromise;
  },

  engineStrings() {
    // Sem os textos o duelo roda igual — só o log fica mais pobre —, então uma
    // falha aqui não pode derrubar o início da partida.
    engineStringsPromise ??= fetchEngineStrings().catch(() => EMPTY_ENGINE_STRINGS);
    return engineStringsPromise;
  },
};
