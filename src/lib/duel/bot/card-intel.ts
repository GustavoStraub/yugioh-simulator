import { OcgType } from "@n1xx1/ocgcore-wasm";

import type { OfficialCardDb } from "@/lib/duel/official-card-data";

/**
 * O que o bot sabe de uma carta antes de decidir.
 *
 * Sai do **banco oficial** (`card-db.json`), e não do catálogo da YGOPRODeck,
 * porque é o mesmo dado que o engine usa: `type` vem como bitfield
 * (`OcgType.QUICKPLAY`, `OcgType.FLIP`, `OcgType.EQUIP`...) em vez das strings
 * para humanos ("Quick-Play Spell"). Decidir a partir de string é onde uma
 * heurística morre em silêncio quando o catálogo muda uma palavra.
 */
export interface CardIntel {
  code: number;
  type: number;
  atk: number;
  def: number;
  level: number;
  isMonster: boolean;
  isSpell: boolean;
  isTrap: boolean;
  isFlip: boolean;
  isEquip: boolean;
  isField: boolean;
  isContinuous: boolean;
  isQuickplay: boolean;
  isCounter: boolean;
  /** Quantos monstros esta invocação normal custa: 0, 1 ou 2. */
  tributes: number;
  /** Monstro de Fusão, Sincro, Xyz ou Link — mora no Extra Deck. */
  isExtraDeck: boolean;
  isXyz: boolean;
  isLink: boolean;
  isPendulum: boolean;
  isTuner: boolean;
  /** Monstro de efeito (sem o bit NORMAL). */
  isEffect: boolean;
  /** Link Rating; 0 fora dos Link. */
  linkRating: number;
  /** Escala de Pêndulo (a esquerda; as duas são iguais em quase todas). */
  scale: number;
}

/** Carta que o banco não conhece — tratada como uma magia normal qualquer. */
const UNKNOWN: Omit<CardIntel, "code"> = {
  type: 0,
  atk: 0,
  def: 0,
  level: 0,
  isMonster: false,
  isSpell: false,
  isTrap: false,
  isFlip: false,
  isEquip: false,
  isField: false,
  isContinuous: false,
  isQuickplay: false,
  isCounter: false,
  tributes: 0,
  isExtraDeck: false,
  isXyz: false,
  isLink: false,
  isPendulum: false,
  isTuner: false,
  isEffect: false,
  linkRating: 0,
  scale: 0,
};

const EXTRA_DECK_TYPES = OcgType.FUSION | OcgType.SYNCHRO | OcgType.XYZ | OcgType.LINK;

/** Tributos exigidos por uma Invocação-Normal, pelas regras de 2005. */
export function tributesForLevel(level: number): number {
  if (level >= 7) return 2;
  if (level >= 5) return 1;
  return 0;
}

export function readIntel(code: number, cardDb: OfficialCardDb): CardIntel {
  const data = cardDb.get(code);
  if (!data) return { code, ...UNKNOWN };

  const type = data.type;
  const isMonster = (type & OcgType.MONSTER) !== 0;
  const isLink = (type & OcgType.LINK) !== 0;
  return {
    code,
    type,
    atk: data.atk,
    // Link não tem DEF: no banco oficial essa coluna guarda as SETAS (um
    // bitmask), e lida como defesa um Link 2 "valia" até 495 de DEF.
    def: isLink ? 0 : data.def,
    // E o "nível" de um Link é o Link Rating — que não pede tributo nenhum.
    level: isLink ? 0 : data.level,
    isMonster,
    isSpell: (type & OcgType.SPELL) !== 0,
    isTrap: (type & OcgType.TRAP) !== 0,
    isFlip: (type & OcgType.FLIP) !== 0,
    isEquip: (type & OcgType.EQUIP) !== 0,
    isField: (type & OcgType.FIELD) !== 0,
    isContinuous: (type & OcgType.CONTINUOUS) !== 0,
    isQuickplay: (type & OcgType.QUICKPLAY) !== 0,
    isCounter: (type & OcgType.COUNTER) !== 0,
    tributes: isLink ? 0 : tributesForLevel(data.level),
    isExtraDeck: isMonster && (type & EXTRA_DECK_TYPES) !== 0,
    isXyz: (type & OcgType.XYZ) !== 0,
    isLink,
    isPendulum: (type & OcgType.PENDULUM) !== 0,
    isTuner: (type & OcgType.TUNER) !== 0,
    isEffect: isMonster && (type & OcgType.NORMAL) === 0,
    linkRating: isLink ? data.level : 0,
    scale: data.lscale,
  };
}

/**
 * O papel que uma carta cumpre numa jogada.
 *
 * Existe porque o bitfield diz *o que a carta é*, nunca *quando vale ativá-la*:
 * "Magia Normal" cobre igualmente o Pote da Ganância (ativar sempre, o quanto
 * antes) e o Buraco Negro (ativar só quando o campo do oponente compensa perder
 * o próprio). Sem essa distinção o bot ou desperdiça a remoção num campo vazio
 * ou nunca compra carta.
 *
 * A lista cobre o que o pool Goat realmente joga; tudo que não está aqui cai na
 * avaliação genérica por bitfield, então um deck fora do pool continua jogável.
 */
export type CardRole =
  /** Compra pura — vantagem sem condição nenhuma. Ativar cedo. */
  | "draw"
  /** Ataca a mão do oponente. Vale mais quanto mais cartas ele tiver. */
  | "handRip"
  /** Limpa TODOS os monstros, inclusive os do bot. */
  | "massRemoval"
  /** Limpa magias/armadilhas do campo — inútil sem backrow do oponente. */
  | "backrowNuke"
  /** Destrói/remove UM monstro do oponente. */
  | "spotRemoval"
  /** Traz um monstro de volta do cemitério. */
  | "revive"
  /** Toma um monstro do oponente. */
  | "steal"
  /** Trava o jogo — só faz sentido quando o bot está atrás no tabuleiro. */
  | "stall"
  /** Armadilha de combate: responde a um ataque. */
  | "battleTrap"
  /** Quebra uma magia/armadilha específica. */
  | "backrowSpot";

export const CARD_ROLES: Readonly<Record<number, CardRole>> = {
  // — Compra —
  55144522: "draw", // Pote da Ganância
  79571449: "draw", // Caridade Graciosa
  37576645: "draw", // Ganância Imprudente

  // — Mão do oponente —
  44763025: "handRip", // Dupla Delinquente
  17375316: "handRip", // Confisco
  42829885: "handRip", // A Sentinela Poderosa

  // — Remoção em massa —
  12580477: "massRemoval", // Raio Relâmpago
  53129443: "massRemoval", // Buraco Negro
  53582587: "massRemoval", // Tributo Torrencial

  // — Backrow —
  19613556: "backrowNuke", // Tempestade Pesada
  18144506: "backrowNuke", // Espanador de Penas da Harpia
  5318639: "backrowSpot", // Tufão Espacial Místico
  60082869: "backrowSpot", // Tornado de Poeira
  17449108: "backrowSpot", // Nobre do Extermínio

  // — Remoção pontual —
  97169186: "spotRemoval", // Solo Devastador
  66788016: "spotRemoval", // Fissura
  79759861: "spotRemoval", // Tributo aos Condenados
  71044499: "spotRemoval", // Nobre da Eliminação
  94192409: "spotRemoval", // Dispositivo de Evacuação Compulsória
  83555666: "spotRemoval", // Anel da Destruição
  29401950: "spotRemoval", // Buraco Armadilha Sem Fundo
  4206964: "spotRemoval", // Buraco Armadilha

  // — Reanimação —
  83764719: "revive", // Reviver Monstro
  70828912: "revive", // Sepultamento Prematuro
  97077563: "revive", // Chamado dos Assombrados

  // — Roubo —
  45986603: "steal", // Roubar
  4031928: "steal", // Mudança de Coração
  87910978: "steal", // Controle Mental

  // — Trava —
  72302403: "stall", // Espadas da Luz Reveladora
  85742772: "stall", // Prisão Gravitacional
  3136426: "stall", // Limite de Nível - Área B
  44656491: "stall", // Mensageiro da Paz

  // — Armadilhas de combate —
  44095762: "battleTrap", // Força do Espelho
  56120475: "battleTrap", // Armadura Sakuretsu
  62279055: "battleTrap", // Cilindro Mágico
  77754944: "battleTrap", // Ruína Generalizada
  12607053: "battleTrap", // Waboku
  36361633: "battleTrap", // Rugido Ameaçador
  // Contra-armadilha, mas o que ela nega é um ataque: o lugar dela é o das
  // outras de combate, não a conta de `scoreCounter` (que não vê ataques).
  14315573: "battleTrap", // Negativação de Ataque
};

export function roleOf(code: number): CardRole | null {
  return CARD_ROLES[code] ?? null;
}

/**
 * O que uma contra-armadilha cobra para negar.
 *
 * O bitfield diz que a carta é uma contra; o preço está só no texto, e é ele
 * que decide se vale gastá-la: metade dos PV no Julgamento Solene, um
 * descarte no Bloqueador de Magia, uma compra de presente para o adversário no
 * Suborno Obscuro. Contra que não está aqui paga o preço genérico de uma carta.
 */
export type CounterCost =
  | { kind: "free" }
  | { kind: "lp"; amount: number | "half" }
  | { kind: "discard" }
  | { kind: "tribute" }
  | { kind: "opponentDraws" };

export const COUNTER_COSTS: Readonly<Record<number, CounterCost>> = {
  41420027: { kind: "lp", amount: "half" }, // Julgamento Solene
  84749824: { kind: "lp", amount: 2000 }, // Aviso Solene
  40605147: { kind: "lp", amount: 1500 }, // Golpe Solene
  3819470: { kind: "lp", amount: 1000 }, // Sete Ferramentas do Bandido
  77414722: { kind: "discard" }, // Bloqueador de Magia
  49010598: { kind: "discard" }, // Cólera Divina
  55256016: { kind: "discard" }, // Julgamento de Anúbis
  98069388: { kind: "tribute" }, // Corneta Celestial
  77538567: { kind: "opponentDraws" }, // Suborno Obscuro
  1637760: { kind: "opponentDraws" }, // Grande Corneta Celestial
  19252988: { kind: "free" }, // Bloqueador de Armadilhas
  70344351: { kind: "free" }, // Campo Riryoku
  59344077: { kind: "free" }, // Drenagem Mágica
};

/**
 * Armadilhas de combate que só seguram o ataque deste turno — não destroem
 * nada. Para quem as ativa são iguais às outras (`battleTrap`); para quem
 * pensa em negá-las, não: negar a Força do Espelho salva o campo, negar o
 * Waboku só deixa passar um ataque.
 */
export const FOG_TRAPS: ReadonlySet<number> = new Set([
  12607053, // Waboku
  36361633, // Rugido Ameaçador
  14315573, // Negativação de Ataque
]);

export function counterCostOf(code: number): CounterCost | null {
  return COUNTER_COSTS[code] ?? null;
}
