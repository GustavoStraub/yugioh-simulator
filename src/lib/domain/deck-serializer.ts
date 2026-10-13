import { expandDeckZone } from "./deck-operations";
import { isDeckDuelReady } from "./deck-rules";

import type { CardRegistry } from "./card-registry";
import type { DeckList, DuelDeckPayload, DuelSetup } from "@/lib/types";
import { FORMAT_RULES, formatOf } from "@/lib/types";

/** Converte DeckList para payload que o ocgcore aceita. */
export function deckToDuelPayload(deck: DeckList): DuelDeckPayload {
  return {
    main: expandDeckZone(deck.main),
    extra: expandDeckZone(deck.extra),
    side: expandDeckZone(deck.side),
    format: formatOf(deck.format),
  };
}

/** Monta config de duelo local (PvE futuro) a partir de um deck salvo. */
export function deckToDuelSetup(
  playerDeck: DeckList,
  opponentName = "Oponente",
  opponentDeck?: DuelDeckPayload,
): DuelSetup | null {
  if (!isDeckDuelReady(playerDeck)) return null;

  return {
    rules: FORMAT_RULES[formatOf(playerDeck.format)],
    player1: {
      name: playerDeck.name,
      deck: deckToDuelPayload(playerDeck),
    },
    player2: {
      name: opponentName,
      deck: opponentDeck ?? { main: [], extra: [], side: [] },
    },
  };
}

/** Resolve refs do deck com dados do registry para exibição. */
export interface ResolvedDeckCard {
  passcode: number;
  name: string;
  nameEn?: string;
  type: string;
  frameType: string;
  imageSmall: string;
  quantity: number;
}

export function resolveDeckZone(
  deck: DeckList,
  zone: "main" | "extra" | "side",
  registry: CardRegistry,
): ResolvedDeckCard[] {
  const resolved: ResolvedDeckCard[] = [];

  for (const ref of deck[zone]) {
    const card = registry.get(ref.passcode);
    if (!card) continue;

    resolved.push({
      passcode: ref.passcode,
      name: card.name,
      nameEn: card.nameEn,
      type: card.type,
      frameType: card.frameType,
      imageSmall: card.images[0]?.image_url_small ?? "",
      quantity: ref.quantity,
    });
  }

  return resolved;
}
