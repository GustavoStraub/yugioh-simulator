import albazStrike from "@/data/deck-guides/albaz-strike.json";
import aesir from "@/data/deck-guides/herois-lendarios-aesir.json";
import destinyHero from "@/data/deck-guides/herois-lendarios-destiny-hero.json";
import phantomKnights from "@/data/deck-guides/herois-lendarios-cavaleiros-fantasmas.json";
import type { DeckGuide } from "@/lib/domain/deck-guide";

/** Conteúdo editorial independente das listas de produto geradas. */
export const DECK_GUIDES: readonly DeckGuide[] = [aesir, destinyHero, phantomKnights, albazStrike] as DeckGuide[];

export function getDeckGuide(id: string): DeckGuide | undefined {
  return DECK_GUIDES.find((guide) => guide.id === id);
}

export function getGuideForPreset(presetId: string): DeckGuide | undefined {
  return DECK_GUIDES.find((guide) => guide.presetId === presetId);
}
