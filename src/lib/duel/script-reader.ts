import { localScriptFor } from "@/lib/duel/local-scripts";
import type { DuelAssets } from "@/lib/duel/duel-assets";
import { patchCoreScript, patchesNaoAplicados } from "@/lib/duel/script-patches";
import type { OfficialCardDb } from "@/lib/duel/official-card-data";

/** Limita o número de requisições simultâneas de scripts. */
const SCRIPT_FETCH_CONCURRENCY = 8;

/**
 * De onde vem o texto de um script Lua.
 *
 * Injetado em vez de fixo porque no navegador é uma requisição a
 * `/api/scripts` e no servidor é uma leitura de disco (ou a busca direta no
 * ProjectIgnis) — e este módulo é o mesmo nos dois.
 */
export type FetchScript = DuelAssets["fetchScript"];

/**
 * Scripts base que o ocgcore precisa ter carregado ANTES de qualquer script de
 * carta. `utility.lua` define `GetID()`, `Auxiliary`/`aux` e todos os helpers
 * usados no topo de cada `c<passcode>.lua`; `constant.lua` define as constantes
 * (`EFFECT_TYPE_FIELD`, `LOCATION_MZONE`, ...). Sem eles todo `initial_effect`
 * falha com "attempt to call a nil value (global 'GetID')".
 *
 * A ordem importa: `constant.lua` primeiro.
 */
export const CORE_SCRIPTS = ["constant.lua", "utility.lua"] as const;

/**
 * Scripts que `constant.lua` e `utility.lua` puxam sozinhos via
 * `Duel.LoadScript(...)`. Essas chamadas passam pelo `scriptReader`, que é
 * síncrono — então precisam estar no cache ANTES do duelo começar, senão
 * helpers como `AddEquipProcedure` ficam nil e os scripts de carta quebram.
 *
 * `proc_unofficial.lua` é referenciado pelo utility.lua mas não existe no
 * repositório; a ausência é tolerada pelo core.
 */
export const SUPPORT_SCRIPTS = [
  "card_counter_constants.lua",
  "archetype_setcode_constants.lua",
  "debug_utility.lua",
  "chain.lua",
  "cards_specific_functions.lua",
  "proc_fusion.lua",
  "proc_fusion_spell.lua",
  "proc_ritual.lua",
  "proc_synchro.lua",
  "proc_union.lua",
  "proc_xyz.lua",
  "proc_pendulum.lua",
  "proc_link.lua",
  "proc_equip.lua",
  "proc_persistent.lua",
  "proc_workaround.lua",
  "proc_normal.lua",
  "proc_skill.lua",
  "proc_rush.lua",
  "proc_maximum.lua",
  "proc_gemini.lua",
  "proc_spirit.lua",
  "deprecated_functions.lua",
] as const;

/**
 * Baixa os scripts base do core.
 *
 * @returns `core` — na ordem em que devem ser passados para `loadScript()`;
 *   `support` — para popular o cache do `scriptReader` de antemão.
 */
export async function preloadCoreScripts(fetchScript: FetchScript): Promise<{
  core: [string, string][];
  support: Map<string, string>;
  /** Emendas locais que não casaram com o script baixado — ver script-patches. */
  patchesAusentes: string[];
}> {
  const [core, support] = await Promise.all([
    Promise.all(
      CORE_SCRIPTS.map(async (name) => {
        const script = await fetchScript(name);
        if (!script) {
          throw new Error(`Falha ao carregar script base do engine: ${name}`);
        }
        return [name, patchCoreScript(name, script)] as [string, string];
      }),
    ),
    (async () => {
      const cache = new Map<string, string>();
      let cursor = 0;

      async function worker() {
        while (cursor < SUPPORT_SCRIPTS.length) {
          const name = SUPPORT_SCRIPTS[cursor];
          cursor += 1;
          const script = await fetchScript(name);
          // As emendas valem para os scripts de apoio também — é no chain.lua,
          // que vive aqui, que mora a correção mais importante.
          if (script) cache.set(name, patchCoreScript(name, script));
        }
      }

      await Promise.all(
        Array.from({ length: SCRIPT_FETCH_CONCURRENCY }, worker),
      );
      return cache;
    })(),
  ]);

  return { core, support, patchesAusentes: patchesNaoAplicados() };
}

/** Resultado do pré-carregamento das cartas. */
export interface DuelScripts {
  cache: Map<string, string>;
  /** Cartas cujo script veio de um passcode alternativo (arte alternativa). */
  viaAlias: { passcode: number; alias: number }[];
  /** Cartas que ficaram sem script nenhum — inertes no duelo. */
  missing: number[];
}

/**
 * Pré-carrega scripts Lua das cartas usadas no duelo.
 *
 * O nome do arquivo NÃO é sempre `c<passcode do deck>.lua`. Quando a carta é
 * uma arte alternativa, o ocgcore pede o script do passcode **original** (é o
 * caso de Reviver Monstro, que a YGOPRODeck devolve como 83764719 enquanto o
 * script mora em `c83764718.lua`). Perguntar isso ao banco oficial em vez de
 * adivinhar é o que faz essas 14 cartas do pool Goat terem efeito.
 *
 * O `scriptReader` do core é síncrono, então tudo precisa estar em cache antes
 * de o duelo começar — daí o pré-carregamento.
 */
export async function preloadDuelScripts(
  passcodes: number[],
  db: OfficialCardDb,
  fetchScript: FetchScript,
): Promise<DuelScripts> {
  const cache = new Map<string, string>();
  const viaAlias: { passcode: number; alias: number }[] = [];
  const missing: number[] = [];
  const unique = [...new Set(passcodes)];
  let cursor = 0;

  async function worker() {
    while (cursor < unique.length) {
      const passcode = unique[cursor];
      cursor += 1;

      const scriptCode = db.scriptPasscode(passcode);
      const fileName = `c${scriptCode}.lua`;
      // Script local primeiro: são justamente as cartas que o repositório
      // remoto não tem, então nem vale gastar a requisição.
      const script =
        localScriptFor(scriptCode) ?? (await fetchScript(fileName));

      if (scriptCode !== passcode && script) {
        viaAlias.push({ passcode, alias: scriptCode });
      }
      if (!script) missing.push(passcode);

      // Cartas sem script (baunilhas) não precisam de um: o core lida com elas
      // nativamente. Um stub com `initial_effect` vazio é suficiente e evita
      // que o core registre "script não encontrado" a cada carta.
      const content = script ?? emptyScript();
      // Sob os dois nomes: qual dos dois o core vai pedir depende de como ele
      // resolve o alias, e um miss aqui deixa a carta inerte sem avisar.
      for (const name of new Set([fileName, `c${passcode}.lua`])) {
        cache.set(name, content);
        cache.set(`official/${name}`, content);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(SCRIPT_FETCH_CONCURRENCY, unique.length) }, worker),
  );

  return { cache, viaAlias, missing };
}

/** Stub no formato ProjectIgnis — depende de `GetID()` do utility.lua. */
function emptyScript(): string {
  return "local s,id=GetID()\nfunction s.initial_effect(c)\nend\n";
}
