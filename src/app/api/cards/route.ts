import { NextResponse } from "next/server";

import { fetchGoatCards } from "@/lib/domain/goat-cards";

/**
 * Serve o catálogo Goat para o navegador.
 *
 * A busca vive em `goat-cards.ts` porque o servidor de duelo online precisa do
 * mesmo catálogo sem passar por HTTP — e sem poder importar este arquivo, que
 * depende de `next/server`.
 */
export async function GET() {
  try {
    const cards = await fetchGoatCards();
    return NextResponse.json({ data: cards, total: cards.length });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro ao buscar cartas.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
