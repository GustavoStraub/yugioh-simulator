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

// O servidor online resolve o `@/` pelo carregador do `server.mjs`
// (`ts-loader-register.mjs`); o harness lê o mesmo pin por caminho relativo.
import { CARDSCRIPTS_RAW_BASE } from "@/lib/duel/cardscripts-pin";

/**
 * Sempre o commit fixo, nunca o `master` — ver `cardscripts-pin.ts`. Ler o
 * `master` fazia o jogo mudar sozinho quando o upstream passava a usar algo
 * que o core compilado ainda não conhece.
 */
const CARDSCRIPTS_BASE = CARDSCRIPTS_RAW_BASE;

const CACHE_TTL_MS = 1000 * 60 * 60 * 24;

/**
 * `body: null` = nenhum candidato existe. Guardar a ausência importa: todo
 * Monstro Normal pede o próprio script e não tem, e sem isso cada duelo
 * refazia as três tentativas no GitHub para cada um deles.
 */
const scriptCache = new Map<string, { body: string | null; fetchedAt: number }>();

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
    // `pre-errata/` por último: no commit fixado, o Red-Eyes Darkness Metal
    // Dragon (88264978) só tem script lá — o de `official/` virou outro
    // passcode. Sem esta tentativa ele entrava no duelo do navegador sem
    // efeito nenhum, enquanto o servidor online (que lê o clone com a mesma
    // ordem de `node-assets.ts`) o achava. Só cartas sem script em
    // `official/` chegam aqui, então nenhuma outra muda de versão.
    return [`official/${scriptPath}`, scriptPath, `pre-errata/${scriptPath}`];
  }
  const fileName = scriptPath.split("/").pop() ?? scriptPath;
  return [scriptPath, `official/${fileName}`];
}

/** Conteúdo do script, ou `null` quando o repositório não o tem. */
export async function fetchCardScript(scriptPath: string): Promise<string | null> {
  const cached = scriptCache.get(scriptPath);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.body;

  // A ausência só vai para o cache quando TODOS os candidatos responderam 404.
  // Uma falha de rede ou um 5xx no meio deixaria a carta sem script por um
  // dia inteiro.
  let ausente = true;
  for (const candidate of candidatesFor(scriptPath)) {
    try {
      const response = await fetch(`${CARDSCRIPTS_BASE}/${candidate}`);
      if (!response.ok) {
        if (response.status !== 404) ausente = false;
        continue;
      }

      const body = await response.text();
      scriptCache.set(scriptPath, { body, fetchedAt: now });
      return body;
    } catch {
      ausente = false;
      continue;
    }
  }

  if (ausente) scriptCache.set(scriptPath, { body: null, fetchedAt: now });
  return null;
}
