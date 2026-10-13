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

import type { CatalogFile } from "@/lib/catalog/catalog-format";
import { CardRegistry } from "@/lib/domain/card-registry";
import { CATALOG_PATH, buildCatalog } from "@/server/catalog/catalog-build";
import { compressJson, type CompressedJson } from "@/server/http/compressed-json";

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

/**
 * O corpo da rota `/api/cards`, comprimido UMA vez por processo (ver
 * `compressed-json.ts`). ETag = a `version` do catálogo, um hash do conteúdo.
 */
let payloadPromise: Promise<CompressedJson> | null = null;

export function loadCatalogPayload(): Promise<CompressedJson> {
  payloadPromise ??= loadCatalog()
    .then((file) => compressJson(file, file.version))
    .catch((error) => {
      payloadPromise = null;
      throw error;
    });
  return payloadPromise;
}
