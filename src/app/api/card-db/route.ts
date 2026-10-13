import cardDb from "@/data/card-db.json";
import { compressJson, compressedJsonResponse, type CompressedJson } from "@/server/http/compressed-json";

/**
 * Serve os dados oficiais das cartas (`cards.cdb` do ProjectIgnis) para o
 * duelo.
 *
 * Fica atrás de uma rota em vez de ser importado no cliente porque são ~14 mil
 * cartas: como módulo entraria inteiro no bundle JS, e como resposta HTTP vai
 * comprimido (`compressed-json.ts`) e cacheado pelo navegador.
 */
let payload: CompressedJson | null = null;

export function GET(request: Request) {
  payload ??= compressJson(cardDb);
  return compressedJsonResponse(request, payload);
}
