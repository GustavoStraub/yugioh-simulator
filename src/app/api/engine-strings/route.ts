import engineStrings from "@/data/engine-strings.json";
import { compressJson, compressedJsonResponse, type CompressedJson } from "@/server/http/compressed-json";

/**
 * Serve as strings que o ocgcore referencia por ID (`strings.conf` +
 * `cards.cdb.texts`) para o duelo resolver rótulos de SELECT_OPTION, textos
 * de HINT, avisos nas cartas e nomes de contador.
 *
 * Fica atrás de uma rota pelo mesmo motivo do `/api/card-db`: ~900 KB (de
 * todas as cartas, desde o pool TCG) que só o cliente do duelo usa — como
 * módulo entraria inteiro no bundle JS de toda a aplicação, e como resposta
 * HTTP vai comprimido (~170 KB) e cacheado pelo navegador.
 */
let payload: CompressedJson | null = null;

export function GET(request: Request) {
  payload ??= compressJson(engineStrings);
  return compressedJsonResponse(request, payload);
}
