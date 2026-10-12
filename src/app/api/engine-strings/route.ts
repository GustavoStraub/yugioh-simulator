import { NextResponse } from "next/server";

import engineStrings from "@/data/engine-strings.json";

/**
 * Serve as strings que o ocgcore referencia por ID (`strings.conf` +
 * `cards.cdb.texts`) para o duelo resolver rótulos de SELECT_OPTION e textos
 * de HINT.
 *
 * Fica atrás de uma rota pelo mesmo motivo do `/api/card-db`: é quase 1 MB de
 * dados que só o cliente do duelo usa — como módulo entraria inteiro no
 * bundle JS de toda a aplicação, e como resposta HTTP é comprimido e cacheado
 * pelo navegador.
 */
export function GET() {
  return NextResponse.json(engineStrings, {
    headers: {
      // O arquivo só muda quando o script de geração roda.
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
