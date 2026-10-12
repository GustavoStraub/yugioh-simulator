import { loadCatalogPayload } from "@/server/catalog/catalog-store";

/**
 * Serve o catálogo de cartas para o navegador — o arquivo enxuto que
 * `catalog-build.ts` monta (pool TCG inteiro + Goat + fichas, texto PT/EN).
 *
 * A busca mora em `catalog-store.ts` porque o servidor de duelo online precisa
 * do mesmo catálogo sem passar por HTTP — e sem poder importar este arquivo.
 *
 * Duas economias, porque o catálogo cru tem ~10 MB:
 *
 * - **Compressão** própria (brotli ou gzip, conforme o navegador aceita): o
 *   Next não comprime a resposta de um route handler aqui.
 * - **ETag** com a `version` do catálogo (um hash do conteúdo): o navegador
 *   revalida a cada visita e, enquanto o catálogo não muda, recebe um 304.
 */
export async function GET(request: Request) {
  try {
    const payload = await loadCatalogPayload();
    if (request.headers.get("if-none-match") === payload.etag) {
      return new Response(null, { status: 304, headers: { ETag: payload.etag } });
    }

    const accepts = request.headers.get("accept-encoding") ?? "";
    const [body, encoding] = /\bbr\b/.test(accepts)
      ? [payload.brotli, "br"]
      : /\bgzip\b/.test(accepts)
        ? [payload.gzip, "gzip"]
        : [payload.json, null];

    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ETag: payload.etag,
        "Cache-Control": "no-cache",
        Vary: "Accept-Encoding",
        ...(encoding ? { "Content-Encoding": encoding } : {}),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro ao montar o catálogo.";
    return Response.json({ error: message }, { status: 502 });
  }
}
