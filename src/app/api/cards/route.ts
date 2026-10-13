import { loadCatalogPayload } from "@/server/catalog/catalog-store";
import { compressedJsonResponse } from "@/server/http/compressed-json";

/**
 * Serve o catálogo de cartas para o navegador — o arquivo enxuto que
 * `catalog-build.ts` monta (pool TCG inteiro + Goat + fichas, texto PT/EN).
 *
 * A busca mora em `catalog-store.ts` porque o servidor de duelo online precisa
 * do mesmo catálogo sem passar por HTTP — e sem poder importar este arquivo.
 * Vai comprimido (~1,6 MB em brotli; ~10 MB cru) e com ETag — revisita é 304.
 */
export async function GET(request: Request) {
  try {
    return compressedJsonResponse(request, await loadCatalogPayload());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro ao montar o catálogo.";
    return Response.json({ error: message }, { status: 502 });
  }
}
