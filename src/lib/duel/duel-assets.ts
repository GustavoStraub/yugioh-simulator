import type { OcgCoreSync } from "@n1xx1/ocgcore-wasm";

import type { EngineStringsDb } from "@/lib/duel/engine-strings";
import type { OfficialCardDb } from "@/lib/duel/official-card-data";
import type { BotAnalysisTransport } from "@/lib/duel/bot/analysis-protocol";

/**
 * De onde a sessão de duelo tira o que não é regra de jogo: o binário do
 * engine, os scripts Lua, o banco oficial e os textos.
 *
 * Existe porque a mesma `DuelSession` roda nos dois lugares. No navegador tudo
 * isso vem por HTTP a partir de caminhos relativos (`/api/scripts`,
 * `/ocgcore/*.wasm`); no servidor não existe origem para resolver esses
 * caminhos, e o dado está no disco ao lado. Sem esta costura o servidor teria
 * que reimplementar o laço de mensagens — que é a parte do código que não se
 * pode ter em duas versões.
 */
export interface DuelAssets {
  createBotWorker?(): BotAnalysisTransport;
  /** Instancia o core wasm já pronto para `createDuel`. */
  loadCore(printErr: (message: string) => void): Promise<OcgCoreSync>;
  /** Conteúdo de um script Lua pelo nome do arquivo, ou `null` se não existir. */
  fetchScript(path: string): Promise<string | null>;
  /** Dados oficiais das cartas (setcode, alias, type) — regras do engine. */
  cardDb(): Promise<OfficialCardDb>;
  /** Textos que o engine referencia por id. Nunca rejeita: sem eles o duelo roda. */
  engineStrings(): Promise<EngineStringsDb>;
}
