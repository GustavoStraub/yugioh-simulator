import hints from "@/data/bot-guide-hints.json";
import { deckSignature } from "@/lib/duel/bot/deck-profile";
import type { GuideDecision } from "@/lib/domain/deck-guide";
import type { DuelDeckPayload, DuelFormat } from "@/lib/types";

export interface BotGuideHints {
  id: string;
  core: readonly number[];
  extra: readonly number[];
  opening: readonly number[];
  plays: readonly { code: number; support: readonly number[]; zone: "grave" | "deck" | "visible" }[];
  decisions: readonly GuideDecision[];
}

const BY_SIGNATURE = new Map<string, BotGuideHints>(hints.map(({ signature, ...hint }) =>
  [signature, hint as BotGuideHints]));

/** Apenas a lista exata do próprio bot recebe prioridades do guia. */
export function guideHintsForDeck(deck: DuelDeckPayload, format: DuelFormat): BotGuideHints | null {
  return BY_SIGNATURE.get(deckSignature(deck, format)) ?? null;
}
