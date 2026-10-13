/**
 * Formato do catálogo de cartas que o servidor monta e o navegador recebe.
 *
 * O catálogo é a parte "para humanos" das cartas — nomes PT/EN, texto, tipo
 * por extenso, banlist, imagens —, montada uma vez a partir da YGOPRODeck e
 * guardada em disco (`catalog-build.ts`). A parte "para o engine" (bitfields,
 * setcodes, alias) continua no `card-db.json`; misturar as duas fontes é o que
 * já quebrou todo `IsSetCard` uma vez.
 *
 * Posicional, como o `card-db.json`: com ~14 mil cartas o formato "um objeto
 * por carta" repete o nome de cada campo 14 mil vezes. Comprimido pelo HTTP, o
 * catálogo inteiro (texto PT e EN incluídos) fica na casa de 2 MB.
 *
 * Este módulo é importado pelos dois lados (navegador e servidor) e só pode
 * conter tipos e funções puras.
 */
import type { CardDefinition, CardImage } from "@/lib/types";

/** Ordem dos campos de cada linha de `CatalogFile.cards`. */
export const CATALOG_FIELDS = [
  "id",
  "arts",
  "name",
  "namePt",
  "type",
  "humanType",
  "frameType",
  "race",
  "attribute",
  "atk",
  "def",
  "level",
  "linkval",
  "linkMarkers",
  "scale",
  "archetype",
  "banTcg",
  "banGoat",
  "goat",
  "playable",
  "desc",
  "descPt",
] as const;

export type BanStatus = "Forbidden" | "Limited" | "Semi-Limited";

/** Uma linha do catálogo, já decodificada. */
export interface CatalogCard {
  /** Passcode oficial — o da arte original, nunca o de uma arte alternativa. */
  id: number;
  /** Passcodes das outras artes da mesma carta. */
  arts: number[];
  name: string;
  namePt: string | null;
  /** Tipo como a YGOPRODeck escreve ("XYZ Monster", "Quick-Play" fica em `race`). */
  type: string;
  humanType: string | null;
  frameType: string;
  race: string | null;
  attribute: string | null;
  atk: number | null;
  /** `null` nos monstros Link — eles não têm DEF. */
  def: number | null;
  /** Nível, ou Rank num Xyz. */
  level: number | null;
  linkval: number | null;
  /** Setas Link na máscara do core (`OcgLinkMarker`). */
  linkMarkers: number | null;
  scale: number | null;
  archetype: string | null;
  banTcg: BanStatus | null;
  banGoat: BanStatus | null;
  /** Está no pool do formato Goat (abril de 2005). */
  goat: boolean;
  /**
   * O engine conhece a carta (há linha no `card-db.json`). Carta lançada depois
   * do snapshot dos dados oficiais aparece no catálogo, mas não entra em deck:
   * sem dados nem script ela entraria no duelo como um monstro qualquer.
   */
  playable: boolean;
  desc: string;
  descPt: string | null;
}

export type CatalogRow = unknown[];

export interface CatalogFile {
  /** Hash do conteúdo — vira o ETag da rota `/api/cards`. */
  version: string;
  builtAt: string;
  fields: readonly string[];
  cards: CatalogRow[];
}

/** Setas Link: nome da YGOPRODeck → bit do `OcgLinkMarker` do core. */
export const LINK_MARKER_BITS: Record<string, number> = {
  "Bottom-Left": 0x001,
  Bottom: 0x002,
  "Bottom-Right": 0x004,
  Left: 0x008,
  Right: 0x020,
  "Top-Left": 0x040,
  Top: 0x080,
  "Top-Right": 0x100,
};

export function encodeCatalogCard(card: CatalogCard): CatalogRow {
  return CATALOG_FIELDS.map((field) => {
    const value = card[field];
    if (field === "goat" || field === "playable") return value ? 1 : 0;
    return value;
  });
}

export function decodeCatalogRow(row: CatalogRow): CatalogCard {
  const card = {} as Record<string, unknown>;
  CATALOG_FIELDS.forEach((field, index) => {
    card[field] = row[index] ?? null;
  });
  card.arts = Array.isArray(card.arts) ? card.arts : [];
  card.goat = card.goat === 1;
  card.playable = card.playable === 1;
  return card as unknown as CatalogCard;
}

/**
 * Onde a imagem de uma arte é servida.
 *
 * Sempre pelo nosso servidor: a YGOPRODeck pede para não fazer hotlink das
 * imagens ("Failure to do so will result in an IP blacklist"). A rota baixa
 * cada imagem uma vez e serve do disco dali em diante.
 */
export function cardImageFor(passcode: number): CardImage {
  return {
    id: passcode,
    image_url: `/card-images/full/${passcode}.jpg`,
    image_url_small: `/card-images/small/${passcode}.jpg`,
    image_url_cropped: `/card-images/cropped/${passcode}.jpg`,
  };
}

/**
 * Linha do catálogo → `CardDefinition`, o formato que o resto do app usa.
 *
 * O nome e o texto em português são os principais quando existem (a interface
 * é em português); o inglês fica em `nameEn`/`descEn` para quem prefere ler a
 * carta como os decks são discutidos. ~3 mil cartas não têm tradução publicada
 * e aparecem em inglês nos dois campos.
 */
export function catalogCardToDefinition(card: CatalogCard): CardDefinition {
  return {
    passcode: card.id,
    name: card.namePt ?? card.name,
    nameEn: card.name,
    type: card.type,
    humanReadableCardType: card.humanType ?? undefined,
    frameType: card.frameType,
    desc: card.descPt ?? card.desc,
    descEn: card.desc,
    atk: card.atk ?? undefined,
    def: card.def ?? undefined,
    level: card.level ?? undefined,
    race: card.race ?? undefined,
    attribute: card.attribute ?? undefined,
    archetype: card.archetype ?? undefined,
    linkval: card.linkval ?? undefined,
    linkMarkers: card.linkMarkers ?? undefined,
    scale: card.scale ?? undefined,
    images: [card.id, ...card.arts].map(cardImageFor),
    banlist: {
      ...(card.banTcg ? { ban_tcg: card.banTcg } : {}),
      ...(card.banGoat ? { ban_goat: card.banGoat } : {}),
    },
    goat: card.goat,
    playable: card.playable,
  };
}
