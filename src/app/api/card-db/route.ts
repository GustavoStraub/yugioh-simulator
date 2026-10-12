import { NextResponse } from "next/server";

import cardDb from "@/data/card-db.json";

/**
 * Serve os dados oficiais das cartas (`cards.cdb` do ProjectIgnis) para o
 * duelo.
 *
 * Fica atrás de uma rota em vez de ser importado no cliente porque são ~14 mil
 * cartas: como módulo entraria inteiro no bundle JS, e como resposta HTTP é
 * comprimido e cacheado pelo navegador.
 */
export function GET() {
  return NextResponse.json(cardDb, {
    headers: {
      // O arquivo só muda quando o script de geração roda.
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
