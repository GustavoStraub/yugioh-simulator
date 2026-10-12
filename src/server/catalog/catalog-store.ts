/**
 * O catálogo em memória do servidor — o mesmo arquivo para a rota `/api/cards`
 * (navegador) e para o duelo online (`cardReader` e narração).
 *
 * Mora fora das rotas porque o servidor de duelo roda em Node puro e não pode
 * importar um route handler (`next/server` só existe no bundler do Next).
 *
 * ⚠️ Importado pelos dois lados (grafo do Next e Node puro): são duas
 * instâncias, cada uma com o seu cache. Desperdício aceitável — o arquivo em
 * disco é a fonte única.
 */
import { existsSync, readFileSync } from "node:fs";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

import type { CatalogFile } from "@/lib/catalog/catalog-format";
import { CardRegistry } from "@/lib/domain/card-registry";
import { CATALOG_PATH, buildCatalog } from "@/server/catalog/catalog-build";

let catalogPromise: Promise<CatalogFile> | null = null;
let registryPromise: Promise<CardRegistry> | null = null;

/**
 * O catálogo, lido do disco — ou montado na hora, se ainda não existir.
 *
 * Montar na primeira requisição custa as quatro buscas à YGOPRODeck (alguns
 * segundos, uma vez só); `npm run build:catalog` faz isso de antemão.
 */
export function loadCatalog(): Promise<CatalogFile> {
  catalogPromise ??= (async () => {
    if (existsSync(CATALOG_PATH)) {
      return JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as CatalogFile;
    }
    return buildCatalog();
  })().catch((error) => {
    // Falhou (rede fora, YGOPRODeck fora do ar): a próxima chamada tenta de
    // novo em vez de ficar presa a um erro em cache.
    catalogPromise = null;
    throw error;
  });
  return catalogPromise;
}

/** Registry montado do catálogo — o duelo online usa este. */
export function loadCatalogRegistry(): Promise<CardRegistry> {
  registryPromise ??= loadCatalog()
    .then((file) => CardRegistry.fromCatalog(file))
    .catch((error) => {
      registryPromise = null;
      throw error;
    });
  return registryPromise;
}

/** O catálogo pronto para o HTTP: o JSON e as versões comprimidas. */
export interface CatalogPayload {
  etag: string;
  json: Buffer;
  gzip: Buffer;
  brotli: Buffer;
}

let payloadPromise: Promise<CatalogPayload> | null = null;

/**
 * O corpo da rota `/api/cards`, comprimido UMA vez por processo.
 *
 * O Next não comprime a resposta de um route handler aqui, e o catálogo cru tem
 * ~10 MB — comprimido fica em ~2 MB (gzip) ou menos (brotli). Comprimir a cada
 * requisição gastaria centenas de milissegundos de CPU por visita.
 */
export function loadCatalogPayload(): Promise<CatalogPayload> {
  payloadPromise ??= loadCatalog()
    .then((file) => {
      const json = Buffer.from(JSON.stringify(file));
      return {
        etag: `"${file.version}"`,
        json,
        gzip: gzipSync(json),
        brotli: brotliCompressSync(json, {
          params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
        }),
      };
    })
    .catch((error) => {
      payloadPromise = null;
      throw error;
    });
  return payloadPromise;
}
