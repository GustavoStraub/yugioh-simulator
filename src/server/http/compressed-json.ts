/**
 * JSON grande servido comprimido, com ETag.
 *
 * O Next não comprime a resposta dos route handlers aqui (medido: o catálogo
 * saía com 10 MB crus), e os dados estáticos do duelo — catálogo, banco
 * oficial, strings do engine — somam ~12 MB. Comprimidos uma vez por processo
 * e servidos conforme o `Accept-Encoding`, viram ~2 MB; com o ETag, a visita
 * seguinte é um 304.
 */
import { createHash } from "node:crypto";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

export interface CompressedJson {
  etag: string;
  json: Buffer;
  gzip: Buffer;
  brotli: Buffer;
}

/**
 * Serializa e comprime. Caro (centenas de ms no catálogo): quem chama guarda o
 * resultado.
 *
 * @param version identificador do conteúdo para o ETag; omitido = hash do JSON.
 */
export function compressJson(value: unknown, version?: string): CompressedJson {
  const json = Buffer.from(JSON.stringify(value));
  const tag = version ?? createHash("sha1").update(json).digest("hex").slice(0, 16);
  return {
    etag: `"${tag}"`,
    json,
    gzip: gzipSync(json),
    brotli: brotliCompressSync(json, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }),
  };
}

/** A resposta HTTP certa para quem pediu: 304, brotli, gzip ou cru. */
export function compressedJsonResponse(request: Request, payload: CompressedJson): Response {
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
      // Revalida sempre (barato: 304); o ETag muda quando o arquivo muda.
      "Cache-Control": "no-cache",
      Vary: "Accept-Encoding",
      ...(encoding ? { "Content-Encoding": encoding } : {}),
    },
  });
}
