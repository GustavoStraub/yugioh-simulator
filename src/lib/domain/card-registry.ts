import {
  catalogCardToDefinition,
  decodeCatalogRow,
  type CatalogFile,
} from "@/lib/catalog/catalog-format";
import type { CardDefinition, Passcode, YgoProDeckCard } from "@/lib/types";

/**
 * Índice das cartas por passcode.
 *
 * Indexa também **cada arte alternativa**: um deck salvo, um deck pré-montado
 * ou uma mensagem do engine podem citar qualquer arte (o Mago Negro tem nove),
 * e a carta precisa ser encontrada por todas. Pedida por uma arte, a carta
 * volta com aquele passcode e aquela imagem na frente — quem montou o deck com
 * a arte bonita continua vendo a arte bonita.
 */
export class CardRegistry {
  private readonly byPasscode = new Map<Passcode, CardDefinition>();
  /** Arte alternativa → carta original. */
  private readonly byArt = new Map<Passcode, CardDefinition>();
  private readonly variants = new Map<Passcode, CardDefinition>();

  constructor(cards: CardDefinition[] = []) {
    for (const card of cards) {
      this.byPasscode.set(card.passcode, card);
    }
    for (const card of cards) {
      for (const image of card.images) {
        if (image.id !== card.passcode && !this.byPasscode.has(image.id)) {
          this.byArt.set(image.id, card);
        }
      }
    }
  }

  static fromApiResponse(cards: YgoProDeckCard[]): CardRegistry {
    return new CardRegistry(cards.map(mapApiCard));
  }

  /** Registry a partir do catálogo enxuto que `/api/cards` serve. */
  static fromCatalog(file: CatalogFile): CardRegistry {
    return new CardRegistry(
      file.cards.map((row) => catalogCardToDefinition(decodeCatalogRow(row))),
    );
  }

  get(passcode: Passcode): CardDefinition | undefined {
    const direct = this.byPasscode.get(passcode);
    if (direct) return direct;

    const original = this.byArt.get(passcode);
    if (!original) return undefined;
    let variant = this.variants.get(passcode);
    if (!variant) {
      const art = original.images.find((image) => image.id === passcode);
      variant = {
        ...original,
        passcode,
        images: art
          ? [art, ...original.images.filter((image) => image !== art)]
          : original.images,
      };
      this.variants.set(passcode, variant);
    }
    return variant;
  }

  getOrThrow(passcode: Passcode): CardDefinition {
    const card = this.get(passcode);
    if (!card) {
      throw new Error(`Carta não encontrada no registry: ${passcode}`);
    }
    return card;
  }

  /** Uma entrada por carta (as artes alternativas não se repetem aqui). */
  getAll(): CardDefinition[] {
    return [...this.byPasscode.values()];
  }

  get size(): number {
    return this.byPasscode.size;
  }

  has(passcode: Passcode): boolean {
    return this.byPasscode.has(passcode) || this.byArt.has(passcode);
  }
}

export function mapApiCard(raw: YgoProDeckCard): CardDefinition {
  return {
    passcode: raw.id,
    name: raw.name,
    nameEn: raw.name_en,
    type: raw.type,
    humanReadableCardType: raw.humanReadableCardType,
    frameType: raw.frameType,
    desc: raw.desc,
    descEn: raw.desc_en,
    atk: raw.atk,
    def: raw.def,
    level: raw.level,
    race: raw.race,
    attribute: raw.attribute,
    archetype: raw.archetype,
    images: raw.card_images,
    banlist: raw.banlist_info,
  };
}
