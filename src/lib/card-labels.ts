const TYPE_LABELS: Record<string, string> = {
  "Normal Monster": "Monstro Normal",
  "Effect Monster": "Monstro de Efeito",
  "Flip Effect Monster": "Monstro de Efeito Flip",
  "Flip Tuner Effect Monster": "Monstro Tuner Flip",
  "Tuner Monster": "Monstro Tuner",
  "Ritual Monster": "Monstro de Ritual",
  "Ritual Effect Monster": "Monstro de Ritual de Efeito",
  "Fusion Monster": "Monstro Fusion",
  "Spell Card": "Magia",
  "Trap Card": "Armadilha",
};

const FRAME_COLORS: Record<string, string> = {
  normal: "border-amber-600/60 bg-amber-950/30",
  effect: "border-orange-500/60 bg-orange-950/30",
  ritual: "border-blue-500/60 bg-blue-950/30",
  fusion: "border-violet-500/60 bg-violet-950/30",
  spell: "border-emerald-600/60 bg-emerald-950/30",
  trap: "border-rose-600/60 bg-rose-950/30",
};

const BANLIST_LABELS: Record<string, string> = {
  Forbidden: "Proibida",
  Limited: "Limitada",
  "Semi-Limited": "Semi-limitada",
};

const RACE_LABELS: Record<string, string> = {
  Spellcaster: "Mago",
  Dragon: "Dragão",
  Zombie: "Zumbi",
  Warrior: "Guerreiro",
  Beast: "Besta",
  "Beast-Warrior": "Besta-Guerreira",
  "Winged Beast": "Besta Alada",
  Fiend: "Demônio",
  Fairy: "Fada",
  Insect: "Inseto",
  Dinosaur: "Dinossauro",
  Reptile: "Réptil",
  Fish: "Peixe",
  "Sea Serpent": "Serpente Marinha",
  Aqua: "Aqua",
  Pyro: "Piro",
  Thunder: "Trovão",
  Rock: "Rocha",
  Plant: "Planta",
  Machine: "Máquina",
  Psychic: "Psíquico",
  "Divine-Beast": "Besta Divina",
  "Creator God": "Deus Criador",
  Wyrm: "Wyrm",
  Cyberse: "Ciberso",
  Normal: "Normal",
  Continuous: "Contínua",
  Equip: "Equipamento",
  Field: "Campo",
  "Quick-Play": "Rápida",
  Ritual: "Ritual",
  Counter: "Contratorrente",
};

export function translateType(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

export function frameColor(frameType: string): string {
  return FRAME_COLORS[frameType] ?? "border-zinc-600/60 bg-zinc-900/40";
}

export function translateBanlist(status?: string): string | null {
  if (!status) return null;
  return BANLIST_LABELS[status] ?? status;
}

export function attributeLabel(attribute?: string): string | null {
  if (!attribute) return null;
  const labels: Record<string, string> = {
    DARK: "TREVAS",
    LIGHT: "LUZ",
    EARTH: "TERRA",
    WATER: "ÁGUA",
    FIRE: "FOGO",
    WIND: "VENTO",
    DIVINE: "DIVINO",
  };
  return labels[attribute] ?? attribute;
}

export function translateRace(race?: string): string | null {
  if (!race) return null;
  return RACE_LABELS[race] ?? race;
}

export function frameAccent(frameType: string): string {
  const accents: Record<string, string> = {
    normal: "from-amber-900/80 to-amber-950",
    effect: "from-orange-900/80 to-orange-950",
    ritual: "from-blue-900/80 to-blue-950",
    fusion: "from-violet-900/80 to-violet-950",
    spell: "from-emerald-900/80 to-emerald-950",
    trap: "from-rose-900/80 to-rose-950",
  };
  return accents[frameType] ?? "from-zinc-800 to-zinc-950";
}

/**
 * Nome (em inglês, formato YGOPRODeck) de cada raça pelo valor bruto que o
 * ocgcore usa (bitmask de `OcgRace`). O binding do engine nomeia as raças
 * diferente da YGOPRODeck (`beast_warrior` vs. `Beast-Warrior`, `divine` vs.
 * `Divine-Beast`...), então não dá para reaproveitar `RACE_LABELS` direto —
 * esta tabela só faz a ponte até o nome que `translateRace` já sabe traduzir.
 */
const OCG_RACE_NAMES: Record<string, string> = {
  1: "Warrior",
  2: "Spellcaster",
  4: "Fairy",
  8: "Fiend",
  16: "Zombie",
  32: "Machine",
  64: "Aqua",
  128: "Pyro",
  256: "Rock",
  512: "Winged Beast",
  1024: "Plant",
  2048: "Insect",
  4096: "Thunder",
  8192: "Dragon",
  16384: "Beast",
  32768: "Beast-Warrior",
  65536: "Dinosaur",
  131072: "Fish",
  262144: "Sea Serpent",
  524288: "Reptile",
  1048576: "Psychic",
  2097152: "Divine-Beast",
  4194304: "Creator God",
  8388608: "Wyrm",
  16777216: "Cyberse",
};

/** Traduz uma raça pelo valor do ocgcore (ANNOUNCE_RACE) — ver `OCG_RACE_NAMES`. */
export function translateOcgRace(race: bigint): string {
  const name = OCG_RACE_NAMES[race.toString()];
  return name ? (translateRace(name) ?? name) : `Raça ${race}`;
}

/**
 * Nome (formato YGOPRODeck) de cada atributo pelo valor bruto do ocgcore
 * (bitmask de `OcgAttribute`). Aqui o nome do engine em maiúsculas já bate
 * com a chave que `attributeLabel` espera — só falta o valor numérico.
 */
const OCG_ATTRIBUTE_NAMES: Record<number, string> = {
  1: "EARTH",
  2: "WATER",
  4: "FIRE",
  8: "WIND",
  16: "LIGHT",
  32: "DARK",
  64: "DIVINE",
};

/** Traduz um atributo pelo valor do ocgcore (ANNOUNCE_ATTRIB) — ver `OCG_ATTRIBUTE_NAMES`. */
export function translateOcgAttribute(attribute: number): string {
  const name = OCG_ATTRIBUTE_NAMES[attribute];
  return name ? (attributeLabel(name) ?? name) : `Atributo ${attribute}`;
}
