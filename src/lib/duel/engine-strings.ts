/**
 * Strings que o ocgcore referencia por ID em vez de mandar por extenso — o
 * mesmo par (`strings.conf` + `cards.cdb.texts`) contra o qual os scripts Lua
 * do ProjectIgnis foram escritos.
 *
 * Por que isso existe: `Duel.SelectOption` (SELECT_OPTION) e `Duel.Hint` com
 * alguns `hint_type` não mandam texto — mandam um inteiro. Sem resolver esse
 * inteiro, a UI só pode mostrar "Opção 1", "Opção 2": o jogador não sabe o que
 * está escolhendo.
 *
 * O inteiro é produzido por `Auxiliary.Stringid(code,id)` em utility.lua:
 *
 *   function Auxiliary.Stringid(code,id)
 *       return (id&0xfffff)|code<<20
 *   end
 *
 * ou seja: os 20 bits baixos (`& 0xfffff`) são o índice da string dentro da
 * carta, e o resto (`>> 20`) é o passcode dela. Verificado batendo isso contra
 * scripts reais — ex.: "Poison of the Old Man" (8842266) chama
 * `Duel.SelectOption(tp,aux.Stringid(id,0),aux.Stringid(id,1))`, e
 * `texts.str1`/`str2` daquele passcode no cards.cdb são exatamente "Gain 1200
 * Life Points."/"Inflict 800 damage to your opponent." — na ordem certa.
 * `id=0` é `str1` (1-based). Isso NÃO é "passcode>>4 / valor&0xf": essa
 * primeira hipótese não sobrevive ao teste com cartas reais.
 *
 * Quando o valor não carrega passcode nenhum — é pequeno, bem abaixo do menor
 * valor possível de `code<<20` para um passcode real (o menor passcode em
 * `cards.cdb` é 483, e mesmo esse já dá 506 milhões) — é uma "system string":
 * um índice fixo em `strings.conf` (Yes/No, Monster/Spell/Trap Cards, "Select
 * the effect you want to activate" etc.), a mesma tabela que o ygopro usa para
 * essas mensagens genéricas.
 *
 * Os dados são gerados por `scripts/build-engine-strings.mjs` em
 * `src/data/engine-strings.json` e servidos por `/api/engine-strings` (mesmo
 * motivo do `/api/card-db`: ~900 KB que só o cliente do duelo precisa).
 */

/** Ponto de corte entre "system string" e "string específica de carta". */
const CARD_STRING_BASE = 0x100000; // 2^20 — o `<<20` de Auxiliary.Stringid.

export interface EngineStringsData {
  /** `strings.conf`, seção `!system`: id numérico -> texto em inglês. */
  system: Record<string, string>;
  /** `cards.cdb.texts`: passcode -> [str1, str2, ...] (1-based na origem). */
  cards: Record<string, string[]>;
}

/**
 * As strings do ProjectIgnis são em inglês, e a UI do app é em português.
 * Não faz sentido traduzir tudo em runtime: as strings de carta SÃO o texto
 * do efeito (a mesma redação da carta), e ficam melhores em inglês do que
 * "Opção 1" — então vão como vieram, sem tradução automática.
 *
 * As poucas "system strings" abaixo são a exceção: aparecem o tempo todo (são
 * as opções literais de cartas GOAT muito jogadas, como o Yes/No de Magic
 * Drain e o Monster/Spell/Trap de Ordeal of a Traveler/Ominous Fortunetelling,
 * e o aviso "selecione o efeito" que precede quase toda carta com
 * `Duel.SelectOption`) — vale a pena traduzir só essas à mão em vez de
 * carregar um dicionário inteiro para textos que quase nunca aparecem em
 * partidas GOAT (ex.: material de Xyz/Link, que nem existe nesse formato).
 */
const SYSTEM_STRING_OVERRIDES_PT: Record<number, string> = {
  70: "Cartas de Monstro", // DECLTYPE_MONSTER — Ordeal of a Traveler, Ominous Fortunetelling
  71: "Cartas de Magia", // DECLTYPE_SPELL
  72: "Cartas de Armadilha", // DECLTYPE_TRAP
  550: "Selecione o efeito que deseja ativar", // HINTMSG_EFFECT
  554: "Declare 1 tipo de carta", // HINTMSG_CARDTYPE
  555: "Escolha uma opção", // HINTMSG_OPTION
  556: "Escolha o efeito a aplicar/resolver", // HINTMSG_RESOLVEEFFECT
  566: "Selecione o efeito a ativar", // HINTMSG_EFFACTIVATE
  1210: "Sair", // Exit
  1211: "OK",
  1212: "Cancelar",
  1213: "Sim", // Yes — Magic Drain usa isso como opção literal
  1214: "Não", // No
};

/** Índice consultável das strings do engine. */
export class EngineStringsDb {
  private readonly system: Record<string, string>;
  private readonly cards: Record<string, string[]>;

  constructor(data: EngineStringsData) {
    this.system = data.system;
    this.cards = data.cards;
  }

  /**
   * Resolve um valor de SELECT_OPTION (ou de um HINT com string embutida) para
   * texto legível. `null` quando não sabemos o que é — nesse caso o chamador
   * deve cair para um rótulo genérico, nunca quebrar o duelo.
   */
  describeOption(value: number): string | null {
    if (!Number.isFinite(value) || value < 0) return null;

    if (value < CARD_STRING_BASE) {
      return SYSTEM_STRING_OVERRIDES_PT[value] ?? this.system[value] ?? null;
    }

    const passcode = Math.floor(value / CARD_STRING_BASE);
    const index = value % CARD_STRING_BASE;
    const strings = this.cards[passcode];
    return strings?.[index] ?? null;
  }

  get systemStringCount(): number {
    return Object.keys(this.system).length;
  }

  get cardCount(): number {
    return Object.keys(this.cards).length;
  }
}

/** Banco vazio — usado quando o download de `/api/engine-strings` falha. */
export const EMPTY_ENGINE_STRINGS = new EngineStringsDb({ system: {}, cards: {} });

/** Busca as strings do engine servidas por `/api/engine-strings`. */
export async function fetchEngineStrings(): Promise<EngineStringsDb> {
  const response = await fetch("/api/engine-strings");
  if (!response.ok) {
    throw new Error(`Falha ao carregar as strings do engine (${response.status}).`);
  }
  return new EngineStringsDb((await response.json()) as EngineStringsData);
}
