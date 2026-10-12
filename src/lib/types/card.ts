/** Passcode oficial da carta — mesmo identificador usado pelo ocgcore. */
export type Passcode = number;

export interface CardImage {
  id: Passcode;
  image_url: string;
  image_url_small: string;
  image_url_cropped: string;
}

export interface BanlistInfo {
  ban_tcg?: "Forbidden" | "Limited" | "Semi-Limited";
  ban_goat?: "Forbidden" | "Limited" | "Semi-Limited";
}

/**
 * Definição estática de uma carta (catálogo / registry).
 * Separada de instâncias em duelo — mesma carta pode existir
 * várias vezes no campo com estados diferentes.
 */
export interface CardDefinition {
  passcode: Passcode;
  name: string;
  nameEn?: string;
  type: string;
  humanReadableCardType?: string;
  frameType: string;
  desc: string;
  atk?: number;
  def?: number;
  level?: number;
  race?: string;
  attribute?: string;
  archetype?: string;
  images: CardImage[];
  banlist?: BanlistInfo;
  /** Texto do efeito em inglês, quando o catálogo trouxe as duas versões. */
  descEn?: string;
}

/** Resposta bruta da YGOPRODeck — convertida para CardDefinition no registry. */
export interface YgoProDeckCard {
  id: Passcode;
  name: string;
  name_en?: string;
  type: string;
  humanReadableCardType?: string;
  frameType: string;
  desc: string;
  atk?: number;
  def?: number;
  level?: number;
  race?: string;
  attribute?: string;
  archetype?: string;
  card_images: CardImage[];
  banlist_info?: BanlistInfo;
  /** Preenchido por `goat-cards.ts` ao casar as respostas pt e en da API. */
  desc_en?: string;
}
