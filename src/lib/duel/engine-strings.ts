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
  /** `strings.conf`, seção `!counter`: tipo do contador (decimal) -> nome. */
  counters?: Record<string, string>;
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
  // Dicas de seleção (`HINTMSG_*`, 500–579): o core manda uma antes de cada
  // pergunta de escolha dizendo O QUE se está escolhendo. A tela usa como
  // instrução da barra de seleção — "Selecione 1 carta" sozinho não diz se é
  // para descartar, banir ou usar como matéria.
  500: "Selecione o(s) card(s) para oferecer como Tributo",
  501: "Selecione o(s) card(s) para descartar",
  502: "Selecione o(s) card(s) para destruir",
  503: "Selecione o(s) card(s) para banir",
  504: "Selecione o(s) card(s) para enviar ao Cemitério",
  505: "Selecione o(s) card(s) para devolver à mão",
  506: "Selecione o(s) card(s) para adicionar à mão",
  507: "Selecione o(s) card(s) para devolver ao Deck",
  508: "Selecione o(s) card(s) para Invocar-Normal",
  509: "Selecione o(s) card(s) para Invocar-Especial",
  510: "Selecione o(s) card(s) para baixar no campo",
  511: "Selecione o(s) card(s) para usar como Matéria de Fusão",
  512: "Selecione o(s) card(s) para usar como Matéria de Sincro",
  513: "Selecione o(s) card(s) para usar como Matéria Xyz",
  514: "Selecione card(s) com a face para cima",
  515: "Selecione card(s) com a face para baixo",
  516: "Selecione monstro(s) em Posição de Ataque",
  517: "Selecione monstro(s) em Posição de Defesa",
  518: "Selecione o(s) card(s) para equipar",
  519: "Selecione a(s) Matéria(s) Xyz para desanexar",
  520: "Selecione o(s) monstro(s) para trocar de controle",
  521: "Selecione o(s) card(s) para substituir",
  522: "Selecione monstro(s) em Posição de Ataque com a face para cima",
  523: "Selecione monstro(s) em Posição de Defesa com a face para cima",
  524: "Selecione monstro(s) em Posição de Ataque com a face para baixo",
  525: "Selecione monstro(s) em Posição de Defesa com a face para baixo",
  526: "Selecione o(s) card(s) para revelar",
  527: "Selecione o(s) card(s) para pôr no campo",
  528: "Selecione o monstro para mudar a posição de batalha",
  529: "Selecione um card seu",
  530: "Selecione um card do oponente",
  531: "Selecione os monstros para a Invocação-Tributo",
  532: "Selecione o(s) monstro(s) de onde desanexar Matéria(s) Xyz",
  533: "Selecione o(s) card(s) para usar como Matéria de Link",
  534: "Selecione o(s) card(s) que ficam no campo",
  549: "Selecione o alvo do ataque",
  551: "Selecione o(s) alvo(s) do efeito",
  552: "Escolha cara ou coroa",
  553: "Escolha o resultado do dado",
  560: "Selecione",
  561: "Escolha a posição de batalha",
  562: "Declare um Atributo",
  563: "Declare um Tipo",
  564: "Declare o nome de um card",
  565: "Declare um número",
  567: "Declare um Nível/Rank",
  568: "Selecione um card para resolver",
  570: "Selecione a(s) zona(s) que ficarão inutilizáveis",
  571: "Selecione a zona para onde o card vai",
  572: "Selecione o(s) card(s) para receber marcador",
  573: "Adicione o(s) card(s) à mão",
  574: "Envie o(s) card(s) ao Cemitério",
  575: "Selecione o(s) card(s) para negar os efeitos",
  576: "Selecione o(s) card(s) para mudar o ATK/DEF",
  577: "Selecione o(s) card(s) para aplicar o efeito",
  578: "Selecione o(s) card(s) para anexar como matéria",
  579: "Selecione o(s) card(s) para devolver ao Cemitério",
  1210: "Sair", // Exit
  1211: "OK",
  1212: "Cancelar",
  1213: "Sim", // Yes — Magic Drain usa isso como opção literal
  1214: "Não", // No

  // Avisos de carta (3000–3314): o que fica escrito na carta enquanto um
  // efeito vale — "não pode ser destruída em batalha", "não pode atacar". São
  // as strings que a mesa mais mostra num duelo moderno (`EFFECT_FLAG_CLIENT_HINT`
  // usa estes ids), e por isso vêm traduzidas.
  3000: "Não pode ser destruída em batalha",
  3001: "Não pode ser destruída por efeitos de card",
  3002: "Não pode ser alvo de efeitos de card",
  3003: "Não pode ser alvo de efeitos de monstro",
  3004: "Não pode ser alvo de efeitos de Magia",
  3005: "Não pode ser alvo de efeitos de Armadilha",
  3006: "Não pode ser alvo de efeitos de Magia/Armadilha",
  3007: "Não pode ser alvo de ataque",
  3008: "Não pode ser destruída em batalha nem por efeitos de card",
  3009: "Não pode ser alvo nem destruída por efeitos de card",
  3010: "Não pode ser destruída por efeitos de monstro",
  3011: "Não pode ser destruída por efeitos de Magia",
  3012: "Não pode ser destruída por efeitos de Armadilha",
  3013: "Não pode ser destruída por efeitos de Magia/Armadilha",
  3030: "Não pode ser destruída pelos seus efeitos de card",
  3031: "Não pode ser alvo dos seus efeitos de card",
  3032: "Não pode ser alvo dos seus efeitos de monstro",
  3033: "Não pode ser alvo das suas Magias",
  3034: "Não pode ser alvo das suas Armadilhas",
  3035: "Não pode ser alvo das suas Magias/Armadilhas",
  3036: "Não pode ser destruída em batalha nem pelos seus efeitos de card",
  3037: "Não pode ser alvo nem destruída pelos seus efeitos de card",
  3060: "Não pode ser destruída por efeitos de card do oponente",
  3061: "Não pode ser alvo de efeitos de card do oponente",
  3062: "Não pode ser alvo de efeitos de monstro do oponente",
  3063: "Não pode ser alvo de Magias do oponente",
  3064: "Não pode ser alvo de Armadilhas do oponente",
  3065: "Não pode ser alvo de Magias/Armadilhas do oponente",
  3066: "Não pode ser destruída em batalha nem por efeitos do oponente",
  3067: "Não pode ser alvo nem destruída por efeitos do oponente",
  3100: "Não é afetada pelos efeitos de outros cards",
  3101: "Não é afetada por efeitos de monstro",
  3102: "Não é afetada por efeitos de Magia",
  3103: "Não é afetada por efeitos de Armadilha",
  3104: "Não é afetada por efeitos de Magia/Armadilha",
  3105: "Não é afetada pelos seus efeitos de card",
  3106: "Não é afetada pelos seus efeitos de monstro",
  3107: "Não é afetada pelas suas Magias",
  3108: "Não é afetada pelas suas Armadilhas",
  3109: "Não é afetada pelas suas Magias/Armadilhas",
  3110: "Não é afetada pelos efeitos do oponente",
  3111: "Não é afetada por efeitos de monstro do oponente",
  3112: "Não é afetada por Magias do oponente",
  3113: "Não é afetada por Armadilhas do oponente",
  3114: "Não é afetada por Magias/Armadilhas do oponente",
  3200: "Deve atacar, se puder",
  3201: "Pode atacar duas vezes",
  3202: "Pode atacar monstros duas vezes",
  3203: "Pode atacar duas vezes seguidas",
  3204: "Pode atacar monstros duas vezes seguidas",
  3205: "Pode atacar diretamente",
  3206: "Não pode atacar",
  3207: "Não pode atacar diretamente",
  3208: "Causa dano de batalha perfurante",
  3209: "Causa o dobro de dano de batalha",
  3210: "Você não recebe dano de batalha envolvendo este card",
  3211: "O oponente também recebe o dano de batalha deste card",
  3212: "O oponente recebe o dano de batalha deste card no seu lugar",
  3213: "Nenhum jogador recebe dano de batalha envolvendo este card",
  3214: "O oponente não recebe dano de batalha envolvendo este card",
  3300: "Banido quando sair do campo",
  3301: "Volta ao Deck quando sair do campo",
  3302: "Não pode ativar os efeitos dele",
  3303: "Não pode ser oferecido como Tributo",
  3304: "Não pode ser Tributo para uma Invocação-Tributo",
  3305: "Não pode ser descartado",
  3306: "Não pode ser banido",
  3307: "Não se pode responder a este card",
  3308: "Não pode ser negado",
  3309: "Não pode ser Matéria de Fusão",
  3310: "Não pode ser Matéria de Sincro",
  3311: "Não pode ser Matéria Xyz",
  3312: "Não pode ser Matéria de Link",
  3313: "Não pode mudar de posição de batalha",
  3314: "Não pode aplicar os efeitos dele",
};

/** Nomes de contador com tradução publicada; o resto vira "Contador X". */
/**
 * Contadores que os scripts usam e o `strings.conf` do ProjectIgnis não
 * nomeia — sem isto a carta mostrava só "Marcador". Achados varrendo os
 * scripts (o `test:marks` refaz a varredura e reprova um tipo novo sem nome).
 */
const COUNTER_FALLBACK: Record<string, string> = {
  // Enneacraft (2025): "place 1 E.C. Counter on this card".
  [String(0x217)]: "E.C. Counter",
};

const COUNTER_NAMES_PT: Record<string, string> = {
  "Spell Counter": "Marcador de Magia",
  "Bushido Counter": "Marcador Bushido",
  "Psychic Counter": "Marcador Psíquico",
  "Shine Counter": "Marcador de Brilho",
  "Crystal Counter": "Marcador de Cristal",
  "Morph Counter": "Marcador de Metamorfose",
  "Venom Counter": "Marcador de Veneno",
  "Thunder Counter": "Marcador de Trovão",
  "Greed Counter": "Marcador de Ganância",
  "Black Feather Counter": "Marcador de Pena Negra",
  "Karakuri Counter": "Marcador Karakuri",
  "Chaos Counter": "Marcador do Caos",
  "Gem Counter": "Marcador de Gema",
  "Clock Counter": "Marcador de Relógio",
  "Gate Counter": "Marcador de Portão",
  "Zushin Counter": "Marcador Zushin",
  "Ice Counter": "Marcador de Gelo",
  "Flower Counter": "Marcador de Flor",
  "Fog Counter": "Marcador de Névoa",
  "Junk Counter": "Marcador de Sucata",
  "Wedge Counter": "Marcador de Cunha",
};

/** Índice consultável das strings do engine. */
export class EngineStringsDb {
  private readonly system: Record<string, string>;
  private readonly cards: Record<string, string[]>;
  private readonly counters: Record<string, string>;

  constructor(data: EngineStringsData) {
    this.system = data.system;
    this.cards = data.cards;
    this.counters = data.counters ?? {};
  }

  /**
   * Nome de um tipo de contador ("Marcador de Magia"), pelo número que o core
   * manda em `ADD_COUNTER` e na consulta `COUNTERS`.
   *
   * O bit 0x1000 marca um contador "permanente" (não sai quando o efeito que o
   * pôs é negado) — é o mesmo contador para o jogador, então o nome é buscado
   * com e sem ele.
   */
  counterName(type: number): string {
    const english =
      this.counters[String(type)] ??
      this.counters[String(type & ~0x1000)] ??
      COUNTER_FALLBACK[String(type)] ??
      COUNTER_FALLBACK[String(type & ~0x1000)] ??
      null;
    if (!english) return "Marcador";
    if (COUNTER_NAMES_PT[english]) return COUNTER_NAMES_PT[english];
    const match = /^(.+?) Counter$/.exec(english);
    return match ? `Marcador ${match[1]}` : english.replace(/^Counter\b/, "Marcador");
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

  /**
   * Texto de um aviso de efeito (o "ⓘ" da carta, o aviso do jogador).
   *
   * Igual a `describeOption`, com uma reserva: o banco do ProjectIgnis deixa
   * vazias algumas strings que os scripts usam como aviso (Burst Stream of
   * Destruction, Noble Knights of the Round Table, Cardcar D… — medido na
   * bateria em massa). A sessão descartava esses avisos em silêncio, e o
   * jogador não sabia que havia algo agindo na carta. Agora diz pelo menos de
   * onde vem: "Efeito de <carta>".
   */
  hintText(value: number, cardName: (code: number) => string): string | null {
    const text = this.describeOption(value);
    if (text) return text;
    if (!Number.isFinite(value) || value < CARD_STRING_BASE) return null;
    return `Efeito de ${cardName(Math.floor(value / CARD_STRING_BASE))}`;
  }

  get systemStringCount(): number {
    return Object.keys(this.system).length;
  }

  get cardCount(): number {
    return Object.keys(this.cards).length;
  }
}

/** Banco vazio — usado quando o download de `/api/engine-strings` falha. */
export const EMPTY_ENGINE_STRINGS = new EngineStringsDb({ system: {}, cards: {}, counters: {} });

/** Busca as strings do engine servidas por `/api/engine-strings`. */
export async function fetchEngineStrings(): Promise<EngineStringsDb> {
  const response = await fetch("/api/engine-strings");
  if (!response.ok) {
    throw new Error(`Falha ao carregar as strings do engine (${response.status}).`);
  }
  return new EngineStringsDb((await response.json()) as EngineStringsData);
}
