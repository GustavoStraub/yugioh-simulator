import { isTokenCard } from "@/lib/duel/card-adapter";
import { banStatus, isExtraDeckCard } from "@/lib/domain/deck-rules";
import type { CardDefinition, DuelFormat } from "@/lib/types";

export type CategoryFilter =
  | "all"
  | "monster"
  | "spell"
  | "trap"
  | "extra";

export type SortKey =
  | "name"
  | "atk"
  | "def"
  | "level"
  | "type"
  | "atkAsc"
  | "levelAsc";

export interface CardFilters {
  search: string;
  category: CategoryFilter;
  /** Atributo bruto da API (DARK, LIGHT, ...) ou "" para todos. */
  attribute: string;
  /** Tipo/raça bruto da API (Dragon, Warrior, Normal, Continuous, ...). */
  race: string;
  /** Nível exato, ou null para todos (Xyz e Link não têm Nível). */
  level: number | null;
  /** Subtipo de monstro (Ritual, Sincro, Xyz, Link, Pêndulo...), ou "". */
  kind: MonsterKind | "";
  /** Rank de um Xyz, ou null. */
  rank: number | null;
  /** Rating de um Link, ou null. */
  linkRating: number | null;
  /** Escala de Pêndulo, ou null. */
  scale: number | null;
  /** Status na banlist DO FORMATO: "" (todos), "legal", "Limited", ... */
  banlist: string;
  minAtk: number | null;
  maxAtk: number | null;
  sort: SortKey;
}

export const EMPTY_FILTERS: CardFilters = {
  search: "",
  category: "all",
  attribute: "",
  race: "",
  level: null,
  kind: "",
  rank: null,
  linkRating: null,
  scale: null,
  banlist: "",
  minAtk: null,
  maxAtk: null,
  sort: "name",
};

export const CATEGORY_OPTIONS: { value: CategoryFilter; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "monster", label: "Monstros" },
  { value: "spell", label: "Magias" },
  { value: "trap", label: "Armadilhas" },
  { value: "extra", label: "Extra" },
];

export type MonsterKind =
  | "normal"
  | "effect"
  | "ritual"
  | "fusion"
  | "synchro"
  | "xyz"
  | "link"
  | "pendulum"
  | "tuner"
  | "flip"
  | "spirit"
  | "union"
  | "gemini"
  | "toon";

/**
 * Subtipos de monstro do filtro. O formato decide quais aparecem: no Goat não
 * existe Sincro, Xyz, Link nem Pêndulo — oferecer o filtro seria oferecer uma
 * lista vazia.
 */
export const MONSTER_KIND_OPTIONS: { value: MonsterKind; label: string; tcgOnly?: boolean }[] = [
  { value: "normal", label: "Normal" },
  { value: "effect", label: "Efeito" },
  { value: "ritual", label: "Ritual" },
  { value: "fusion", label: "Fusão" },
  { value: "synchro", label: "Sincro", tcgOnly: true },
  { value: "xyz", label: "Xyz", tcgOnly: true },
  { value: "link", label: "Link", tcgOnly: true },
  { value: "pendulum", label: "Pêndulo", tcgOnly: true },
  { value: "tuner", label: "Regulador", tcgOnly: true },
  { value: "flip", label: "Virar (Flip)" },
  { value: "spirit", label: "Espírito" },
  { value: "union", label: "União" },
  { value: "gemini", label: "Gêmeos" },
  { value: "toon", label: "Toon" },
];

/** Palavras do tipo da YGOPRODeck ("Synchro Tuner Monster") por subtipo. */
const KIND_WORD: Record<MonsterKind, string> = {
  normal: "Normal",
  effect: "Effect",
  ritual: "Ritual",
  fusion: "Fusion",
  synchro: "Synchro",
  xyz: "XYZ",
  link: "Link",
  pendulum: "Pendulum",
  tuner: "Tuner",
  flip: "Flip",
  spirit: "Spirit",
  union: "Union",
  gemini: "Gemini",
  toon: "Toon",
};

export function isMonster(card: CardDefinition): boolean {
  return card.type.includes("Monster");
}

export function isXyz(card: CardDefinition): boolean {
  return card.frameType.startsWith("xyz") || card.type.includes("XYZ");
}

export function isLink(card: CardDefinition): boolean {
  return card.frameType === "link" || card.type.includes("Link");
}

function matchesKind(card: CardDefinition, kind: MonsterKind): boolean {
  if (!isMonster(card)) return false;
  const words = `${card.humanReadableCardType ?? ""} ${card.type}`;
  // "Effect": todo monstro que não é Normal (os de Extra Deck sem a palavra
  // no tipo — "Synchro Monster" — são de efeito na prática).
  if (kind === "effect") return !words.includes("Normal") || words.includes("Effect");
  return words.includes(KIND_WORD[kind]);
}

export const ATTRIBUTE_OPTIONS = [
  { value: "DARK", label: "TREVAS" },
  { value: "LIGHT", label: "LUZ" },
  { value: "EARTH", label: "TERRA" },
  { value: "WATER", label: "ÁGUA" },
  { value: "FIRE", label: "FOGO" },
  { value: "WIND", label: "VENTO" },
  { value: "DIVINE", label: "DIVINO" },
];

export const BANLIST_OPTIONS = [
  { value: "legal", label: "Sem restrição" },
  { value: "Semi-Limited", label: "Semi-limitada" },
  { value: "Limited", label: "Limitada" },
  { value: "Forbidden", label: "Proibida" },
];

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "name", label: "Nome" },
  { value: "atk", label: "ATK ↓" },
  { value: "atkAsc", label: "ATK ↑" },
  { value: "def", label: "DEF ↓" },
  { value: "level", label: "Nível ↓" },
  { value: "levelAsc", label: "Nível ↑" },
  { value: "type", label: "Tipo" },
];

function matchesCategory(card: CardDefinition, category: CategoryFilter): boolean {
  switch (category) {
    case "monster":
      return card.type.includes("Monster") && !isExtraDeckCard(card);
    case "spell":
      return card.type.includes("Spell");
    case "trap":
      return card.type.includes("Trap");
    case "extra":
      return isExtraDeckCard(card);
    default:
      return true;
  }
}

function matchesBanlist(card: CardDefinition, filter: string, format: DuelFormat): boolean {
  // Só a lista do formato: carta sem status no Goat é livre no Goat, mesmo que
  // esteja proibida no TCG de hoje.
  const status = banStatus(card, format);
  if (filter === "legal") return !status;
  return status === filter;
}

/**
 * Lista as raças/tipos presentes no conjunto atual — evita oferecer filtros
 * que não retornariam nada. Para magias/armadilhas o campo `race` da API
 * guarda o subtipo (Contínua, Rápida, Equipamento...).
 */
export function availableRaces(cards: CardDefinition[]): string[] {
  const races = new Set<string>();
  for (const card of cards) {
    if (card.race) races.add(card.race);
  }
  return [...races].sort();
}

/** Níveis presentes (sem os Xyz, cujo `level` é Rank, nem os Link). */
export function availableLevels(cards: CardDefinition[]): number[] {
  const levels = new Set<number>();
  for (const card of cards) {
    if (card.level && !isXyz(card) && !isLink(card)) levels.add(card.level);
  }
  return [...levels].sort((a, b) => a - b);
}

export function availableRanks(cards: CardDefinition[]): number[] {
  const ranks = new Set<number>();
  for (const card of cards) {
    if (isXyz(card) && card.level) ranks.add(card.level);
  }
  return [...ranks].sort((a, b) => a - b);
}

export function availableLinkRatings(cards: CardDefinition[]): number[] {
  const ratings = new Set<number>();
  for (const card of cards) {
    if (card.linkval) ratings.add(card.linkval);
  }
  return [...ratings].sort((a, b) => a - b);
}

export function availableScales(cards: CardDefinition[]): number[] {
  const scales = new Set<number>();
  for (const card of cards) {
    if (card.scale !== undefined && card.frameType.includes("pendulum")) scales.add(card.scale);
  }
  return [...scales].sort((a, b) => a - b);
}

/**
 * Normaliza para busca: minúsculas e **sem acento**.
 *
 * O catálogo está em português, e ninguém digita "Dragão Branco de Olhos
 * Azuis" com o til no meio de uma busca. Sem isto, "dragao" não achava nada —
 * o filtro parecia quebrado justamente nas cartas mais procuradas.
 */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Cache do texto pesquisável — recalcular a cada tecla custa caro em ~14 mil cartas. */
const buscavel = new WeakMap<CardDefinition, string>();

function textoBuscavel(card: CardDefinition): string {
  const existente = buscavel.get(card);
  if (existente !== undefined) return existente;

  const texto = normalizar(
    // Texto em português E em inglês: a carta sem tradução tem o texto só em
    // inglês, e quem lê as cartas em inglês busca pelo que lê.
    [card.name, card.nameEn ?? "", card.archetype ?? "", card.race ?? "", card.desc, card.descEn ?? ""]
      .join(" "),
  );
  buscavel.set(card, texto);
  return texto;
}

export function applyCardFilters(
  cards: CardDefinition[],
  filters: CardFilters,
  /** Formato do deck aberto — decide qual banlist o filtro lê. */
  format: DuelFormat = "goat",
): CardDefinition[] {
  // Cada palavra é um requisito separado: "dragao luz" acha o dragão de LUZ
  // sem depender da ordem em que os termos aparecem no texto da carta.
  const termos = normalizar(filters.search).split(/\s+/).filter(Boolean);

  const filtered = cards.filter((card) => {
    // Fichas existem no catálogo só para o engine poder criá-las; não são
    // cartas de deck e não devem aparecer no construtor.
    if (isTokenCard(card)) return false;
    if (termos.length > 0) {
      const texto = textoBuscavel(card);
      if (!termos.every((termo) => texto.includes(termo))) return false;
    }
    if (!matchesCategory(card, filters.category)) return false;
    if (filters.attribute && card.attribute !== filters.attribute) return false;
    if (filters.race && card.race !== filters.race) return false;
    if (filters.level !== null && (card.level !== filters.level || isXyz(card) || isLink(card))) {
      return false;
    }
    if (filters.kind && !matchesKind(card, filters.kind)) return false;
    if (filters.rank !== null && (!isXyz(card) || card.level !== filters.rank)) return false;
    if (filters.linkRating !== null && card.linkval !== filters.linkRating) return false;
    if (
      filters.scale !== null &&
      (!card.frameType.includes("pendulum") || card.scale !== filters.scale)
    ) {
      return false;
    }
    if (filters.banlist && !matchesBanlist(card, filters.banlist, format)) return false;
    if (filters.minAtk !== null && (card.atk ?? -1) < filters.minAtk) return false;
    if (filters.maxAtk !== null && (card.atk ?? Infinity) > filters.maxAtk) {
      return false;
    }
    return true;
  });

  return sortCards(filtered, filters.sort);
}

function sortCards(cards: CardDefinition[], sort: SortKey): CardDefinition[] {
  const sorted = [...cards];

  switch (sort) {
    case "atk":
      // Cartas sem ATK (magias/armadilhas) vão para o fim, não para o topo.
      sorted.sort((a, b) => (b.atk ?? -1) - (a.atk ?? -1));
      break;
    case "atkAsc":
      // No sentido crescente as sem ATK vão para o fim do mesmo jeito — senão
      // procurar "o monstro mais fraco" devolveria uma tela de magias.
      sorted.sort((a, b) => (a.atk ?? Infinity) - (b.atk ?? Infinity));
      break;
    case "levelAsc":
      sorted.sort((a, b) => (a.level ?? Infinity) - (b.level ?? Infinity));
      break;
    case "def":
      sorted.sort((a, b) => (b.def ?? -1) - (a.def ?? -1));
      break;
    case "level":
      sorted.sort((a, b) => (b.level ?? -1) - (a.level ?? -1));
      break;
    case "type":
      sorted.sort(
        (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
      );
      break;
    default:
      sorted.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }

  return sorted;
}

/** Quantos filtros (fora a busca) estão ativos — usado no botão "limpar". */
export function activeFilterCount(filters: CardFilters): number {
  let count = 0;
  if (filters.category !== "all") count += 1;
  if (filters.attribute) count += 1;
  if (filters.race) count += 1;
  if (filters.level !== null) count += 1;
  if (filters.kind) count += 1;
  if (filters.rank !== null) count += 1;
  if (filters.linkRating !== null) count += 1;
  if (filters.scale !== null) count += 1;
  if (filters.banlist) count += 1;
  if (filters.minAtk !== null) count += 1;
  if (filters.maxAtk !== null) count += 1;
  return count;
}
