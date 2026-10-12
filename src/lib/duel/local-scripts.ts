/**
 * Scripts Lua mantidos localmente — escotilha de emergência.
 *
 * Serve para cartas que o repositório do ProjectIgnis realmente não tem. Hoje
 * está vazio: o que parecia "carta sem script" era, na verdade, carta com
 * `alias` — artes alternativas cujo script mora sob o passcode ORIGINAL. Com o
 * banco oficial em uso (`official-card-data.ts`), o `script-reader` pede o
 * arquivo certo e as 15 cartas do pool Goat nessa situação passaram a
 * funcionar sozinhas, incluindo Reviver Monstro, Oferendas Supremas, Dian Keto
 * e o Dragão Barril — que antes não tinha script nenhum.
 *
 * ⚠️ Um script escrito aqui NÃO passa pela revisão da comunidade do
 * ProjectIgnis. Antes de adicionar um, confirme que a carta não é só um alias
 * mal resolvido — foi o que enganou da primeira vez.
 *
 * Padrão esperado: `EFFECT_TYPE_ACTIVATE` + `EVENT_FREE_CHAIN` para Magias
 * Normais, com `target` publicando a informação da operação (para outras
 * cartas poderem reagir) e `operation` aplicando o efeito.
 */
export const LOCAL_CARD_SCRIPTS: Record<number, string> = {};

/** Devolve o script local de uma carta, se existir. */
export function localScriptFor(passcode: number): string | null {
  return LOCAL_CARD_SCRIPTS[passcode] ?? null;
}
