/**
 * Busca de scripts Lua no repositório do ProjectIgnis.
 *
 * Mora fora da rota `/api/scripts` porque o servidor de duelo online precisa
 * exatamente disto e **não pode importar um route handler**: `next/server` só
 * existe dentro do bundler do Next, e o servidor customizado roda em Node
 * puro. Duplicar a busca criaria dois caminhos que divergem no primeiro ajuste
 * de fallback — e é justamente o fallback (`official/` antes da raiz) que faz
 * metade das cartas encontrarem script.
 *
 * ⚠️ Este módulo é importado pelos dois lados (grafo do Next e Node puro), o
 * que significa **duas instâncias** e portanto dois caches. É desperdício
 * aceitável; o que não vale é tratar o cache daqui como fonte única.
 */

const CARDSCRIPTS_BASE =
  "https://raw.githubusercontent.com/ProjectIgnis/CardScripts/master";

const CACHE_TTL_MS = 1000 * 60 * 60 * 24;

const scriptCache = new Map<string, { body: string; fetchedAt: number }>();

/**
 * Ordem de tentativa para um caminho pedido.
 *
 * O repositório separa `official/` (o pool que o jogo usa) da raiz (onde ficam
 * os utilitários). Um `c<passcode>.lua` quase sempre está em `official/`; um
 * `utility.lua` está na raiz. Procurar na ordem errada devolve 404 para cartas
 * que existem.
 */
function candidatesFor(scriptPath: string): string[] {
  if (/^c\d+\.lua$/i.test(scriptPath)) {
    return [`official/${scriptPath}`, scriptPath];
  }
  const fileName = scriptPath.split("/").pop() ?? scriptPath;
  return [scriptPath, `official/${fileName}`];
}

/** Conteúdo do script, ou `null` quando o repositório não o tem. */
export async function fetchCardScript(scriptPath: string): Promise<string | null> {
  const cached = scriptCache.get(scriptPath);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.body;

  for (const candidate of candidatesFor(scriptPath)) {
    try {
      const response = await fetch(`${CARDSCRIPTS_BASE}/${candidate}`);
      if (!response.ok) continue;

      const body = await response.text();
      scriptCache.set(scriptPath, { body, fetchedAt: now });
      return body;
    } catch {
      continue;
    }
  }

  return null;
}
