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
};

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
  return {
    code,
    type,
    atk: data.atk,
    def: data.def,
    level: data.level,
    isMonster: (type & OcgType.MONSTER) !== 0,
    isSpell: (type & OcgType.SPELL) !== 0,
    isTrap: (type & OcgType.TRAP) !== 0,
    isFlip: (type & OcgType.FLIP) !== 0,
    isEquip: (type & OcgType.EQUIP) !== 0,
    isField: (type & OcgType.FIELD) !== 0,
    isContinuous: (type & OcgType.CONTINUOUS) !== 0,
    isQuickplay: (type & OcgType.QUICKPLAY) !== 0,
    isCounter: (type & OcgType.COUNTER) !== 0,
    tributes: tributesForLevel(data.level),
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
  18144507: "backrowNuke", // Espanador de Penas da Harpia
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
};

export function roleOf(code: number): CardRole | null {
  return CARD_ROLES[code] ?? null;
}
