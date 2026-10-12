import { NextResponse } from "next/server";

import { fetchCardScript } from "@/lib/duel/script-source";

/**
 * Espelha os scripts Lua do ProjectIgnis para o navegador.
 *
 * A busca em si vive em `script-source.ts` porque o servidor de duelo online
 * precisa dela sem passar por HTTP — e sem poder importar este arquivo, que
 * depende de `next/server`.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const body = await fetchCardScript(path.join("/"));

  if (body === null) {
    return NextResponse.json({ error: "Script não encontrado." }, { status: 404 });
  }

  return new NextResponse(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
