import {
  OcgAttribute,
  OcgRace,
  OcgType,
  type OcgCardData,
} from "@n1xx1/ocgcore-wasm";

import {
  EMPTY_CARD_DB,
  type OfficialCardDb,
} from "@/lib/duel/official-card-data";
import type { CardDefinition } from "@/lib/types";

const ATTRIBUTE_MAP: Record<string, number> = {
  EARTH: OcgAttribute.EARTH,
  WATER: OcgAttribute.WATER,
  FIRE: OcgAttribute.FIRE,
  WIND: OcgAttribute.WIND,
  LIGHT: OcgAttribute.LIGHT,
  DARK: OcgAttribute.DARK,
  DIVINE: OcgAttribute.DIVINE,
};

const RACE_MAP: Record<string, bigint> = {
  Warrior: OcgRace.WARRIOR,
  Spellcaster: OcgRace.SPELLCASTER,
  Fairy: OcgRace.FAIRY,
  Fiend: OcgRace.FIEND,
  Zombie: OcgRace.ZOMBIE,
  Machine: OcgRace.MACHINE,
  Aqua: OcgRace.AQUA,
  Pyro: OcgRace.PYRO,
  Rock: OcgRace.ROCK,
  "Winged Beast": OcgRace.WINGEDBEAST,
  Plant: OcgRace.PLANT,
  Insect: OcgRace.INSECT,
  Thunder: OcgRace.THUNDER,
  Dragon: OcgRace.DRAGON,
  Beast: OcgRace.BEAST,
  "Beast-Warrior": OcgRace.BEASTWARRIOR,
  Dinosaur: OcgRace.DINOSAUR,
  Fish: OcgRace.FISH,
  "Sea Serpent": OcgRace.SEASERPENT,
  Reptile: OcgRace.REPTILE,
  Psychic: OcgRace.PSYCHIC,
  Divine: OcgRace.DIVINE,
  "Creator God": OcgRace.CREATORGOD,
  Wyrm: OcgRace.WYRM,
  Cyberse: OcgRace.CYBERSE,
};

/**
 * Fichas com dados corrigidos à mão.
 *
 * Scripts criam fichas com passcodes **consecutivos** (`id+1`..`id+4` no Bode
 * Expiatório) e a base pública só publica a primeira, sem nível/atributo. Sem
 * isso as fichas do card que dá nome ao formato saíam sem raça nem atributo, o
 * que afeta qualquer carta que checasse Besta ou TERRA.
 */
const TOKEN_OVERRIDES: Record<
  number,
  { level: number; attack: number; defense: number; race: bigint; attribute: number }
> = (() => {
  const ovelha = {
    level: 1,
    attack: 0,
    defense: 0,
    race: OcgRace.BEAST,
    attribute: OcgAttribute.EARTH,
  };
  // Bode Expiatório (73915051) cria 73915052..73915055.
  return {
    73915052: ovelha,
    73915053: ovelha,
    73915054: ovelha,
    73915055: ovelha,
  };
})();

/** Ficha criada por um efeito — não é carta de deck. */
export function isTokenCard(card: CardDefinition): boolean {
  return card.type === "Token" || card.frameType === "token";
}

function parseCardType(card: CardDefinition): number {
  // Ficha é um monstro do tipo TOKEN. A YGOPRODeck não publica ATK/DEF/nível
  // delas (o texto diz que vêm da carta que cria), então o engine recebe os
  // valores neutros e o script da carta criadora ajusta o que precisar.
  if (isTokenCard(card)) {
    return OcgType.MONSTER | OcgType.NORMAL | OcgType.TOKEN;
  }

  const baseType = card.type.toLowerCase();
  const detail = (card.humanReadableCardType ?? card.type).toLowerCase();
  let type = 0;

  if (baseType.includes("monster")) type |= OcgType.MONSTER;
  else if (baseType.includes("spell")) type |= OcgType.SPELL;
  else if (baseType.includes("trap")) type |= OcgType.TRAP;

  if (detail.includes("normal") && !detail.includes("trap")) {
    type |= OcgType.NORMAL;
  }
  if (detail.includes("effect")) type |= OcgType.EFFECT;
  if (detail.includes("fusion") || baseType.includes("fusion")) {
    type |= OcgType.FUSION;
  }
  if (detail.includes("ritual") || baseType.includes("ritual")) {
    type |= OcgType.RITUAL;
  }
  if (detail.includes("flip")) type |= OcgType.FLIP;
  if (detail.includes("spirit")) type |= OcgType.SPIRIT;
  if (detail.includes("union")) type |= OcgType.UNION;
  if (detail.includes("gemini")) type |= OcgType.GEMINI;
  if (detail.includes("toon")) type |= OcgType.TOON;
  if (detail.includes("tuner")) type |= OcgType.TUNER;
  if (detail.includes("quick-play") || detail.includes("quickplay")) {
    type |= OcgType.QUICKPLAY;
  }
  if (detail.includes("continuous")) type |= OcgType.CONTINUOUS;
  if (detail.includes("equip")) type |= OcgType.EQUIP;
  if (detail.includes("field")) type |= OcgType.FIELD;
  if (detail.includes("counter")) type |= OcgType.COUNTER;
  if (detail.includes("trap monster") || detail.includes("trapmonster")) {
    type |= OcgType.TRAPMONSTER;
  }

  if ((type & OcgType.MONSTER) && !(type & (OcgType.NORMAL | OcgType.EFFECT))) {
    type |= card.frameType === "normal" ? OcgType.NORMAL : OcgType.EFFECT;
  }

  if ((type & OcgType.SPELL) && type === OcgType.SPELL) {
    type |= OcgType.NORMAL;
  }
  if ((type & OcgType.TRAP) && type === OcgType.TRAP) {
    type |= OcgType.NORMAL;
  }

  return type;
}

/**
 * Dados de uma ficha genérica, para códigos que o catálogo não conhece.
 *
 * Efeitos criam fichas cujos passcodes nem sempre estão na base pública (o
 * "Trio Ojama" usa três). Devolver `null` para o engine nesse caso quebra a
 * carta inteira; uma ficha neutra mantém o efeito funcionando. ATK/DEF podem
 * sair errados para fichas que não sejam 0/0 — melhor isso do que a carta não
 * funcionar.
 */
export function genericTokenData(
  code: number,
  db: OfficialCardDb = EMPTY_CARD_DB,
): OcgCardData {
  // O banco oficial conhece a maioria das fichas com nome próprio (e traz
  // nível/raça/atributo corretos); o override só cobre o que ele não tem.
  const official = db.get(code);
  if (official) return officialToOcgData(code, official);

  const conhecida = TOKEN_OVERRIDES[code];
  return {
    code,
    alias: 0,
    setcodes: [],
    type: OcgType.MONSTER | OcgType.NORMAL | OcgType.TOKEN,
    level: conhecida?.level ?? 1,
    attribute: conhecida?.attribute ?? 0,
    race: conhecida?.race ?? 0n,
    attack: conhecida?.attack ?? 0,
    defense: conhecida?.defense ?? 0,
    lscale: 0,
    rscale: 0,
    link_marker: 0,
  };
}

/**
 * Setas e DEF de um monstro, como o core espera.
 *
 * Num monstro Link a coluna `def` do `cards.cdb` não é DEF nenhuma: são as
 * **setas** (Link Spider `0x02` = baixo; Decode Talker `0x85` = cima,
 * baixo-esquerda, baixo-direita) — e `level` é o rating. Mandar `def` como
 * defesa e `link_marker: 0`, como antes, deixava todo Link sem seta: ele não
 * apontava para zona nenhuma, e as cartas que dependem disso (co-link, zonas
 * apontadas, "monstro para o qual este card aponta") simplesmente não
 * funcionavam.
 */
export function linkFields(type: number, def: number): { defense: number; link_marker: number } {
  return (type & OcgType.LINK) !== 0
    ? { defense: 0, link_marker: def }
    : { defense: def, link_marker: 0 };
}

/** Converte uma linha do banco oficial no formato que o core espera. */
function officialToOcgData(
  code: number,
  official: NonNullable<ReturnType<OfficialCardDb["get"]>>,
): OcgCardData {
  return {
    code,
    // `alias` faz o core tratar a carta como outra: é o que torna
    // "Harpie Lady 1" uma "Harpie Lady" para Elegant Egotist e cia., e o que
    // liga uma arte alternativa à carta original.
    alias: official.alias,
    // O "arquétipo" na visão do engine. Sem ele todo `IsSetCard(...)` falha.
    setcodes: official.setcodes,
    type: official.type,
    level: official.level,
    attribute: official.attribute,
    race: BigInt(official.race),
    attack: official.atk,
    lscale: official.lscale,
    rscale: official.rscale,
    ...linkFields(official.type, official.def),
  };
}

export function cardDefinitionToOcgData(
  card: CardDefinition,
  db: OfficialCardDb = EMPTY_CARD_DB,
): OcgCardData {
  // Fonte da verdade: o banco oficial. As strings da YGOPRODeck só entram
  // quando a carta não está lá (acontece com pouquíssimas artes alternativas).
  const official = db.get(card.passcode);
  if (official) return officialToOcgData(card.passcode, official);

  const attributeKey = card.attribute?.toUpperCase() ?? "";
  const raceKey = card.race ?? "";

  // A YGOPRODeck não publica nível/ATK/DEF de fichas (o texto delas diz que
  // vêm da carta que as cria). O padrão de fato é Nível 1 / 0 / 0 — é o caso
  // da Ficha de Ovelha do Bode Expiatório, e nível 0 quebraria interações
  // como Gravity Bind, Level Limit - Area B e tributos.
  if (isTokenCard(card)) {
    const base = genericTokenData(card.passcode, db);
    // O override tem prioridade; o catálogo preenche o que sobrar.
    return {
      ...base,
      level: base.level || (card.level ?? 1),
      attribute: base.attribute || (ATTRIBUTE_MAP[attributeKey] ?? 0),
      race: base.race || (RACE_MAP[raceKey] ?? 0n),
      attack: base.attack || (card.atk ?? 0),
      defense: base.defense || (card.def ?? 0),
    };
  }

  return {
    code: card.passcode,
    alias: 0,
    setcodes: [],
    type: parseCardType(card),
    level: card.level ?? 0,
    attribute: ATTRIBUTE_MAP[attributeKey] ?? 0,
    race: RACE_MAP[raceKey] ?? 0n,
    attack: card.atk ?? 0,
    defense: card.def ?? 0,
    lscale: 0,
    rscale: 0,
    link_marker: 0,
  };
}
