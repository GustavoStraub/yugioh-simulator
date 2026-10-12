import type { CardDefinition, Passcode, YgoProDeckCard } from "@/lib/types";

export class CardRegistry {
  private readonly byPasscode = new Map<Passcode, CardDefinition>();

  constructor(cards: CardDefinition[] = []) {
    for (const card of cards) {
      this.byPasscode.set(card.passcode, card);
    }
  }

  static fromApiResponse(cards: YgoProDeckCard[]): CardRegistry {
    return new CardRegistry(cards.map(mapApiCard));
  }

  get(passcode: Passcode): CardDefinition | undefined {
    return this.byPasscode.get(passcode);
  }

  getOrThrow(passcode: Passcode): CardDefinition {
    const card = this.get(passcode);
    if (!card) {
      throw new Error(`Carta não encontrada no registry: ${passcode}`);
    }
    return card;
  }

  getAll(): CardDefinition[] {
    return [...this.byPasscode.values()];
  }

  get size(): number {
    return this.byPasscode.size;
  }

  has(passcode: Passcode): boolean {
    return this.byPasscode.has(passcode);
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
