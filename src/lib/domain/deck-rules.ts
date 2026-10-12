import { GOAT_FORMAT_RULES } from "@/lib/types";
import type { CardDefinition, DeckList, DeckZone, Passcode } from "@/lib/types";

export const DECK_LIMITS = {
  main: {
    min: GOAT_FORMAT_RULES.minMainDeck,
    max: GOAT_FORMAT_RULES.maxMainDeck,
  },
  extra: { min: 0, max: GOAT_FORMAT_RULES.maxExtraDeck },
  side: { min: 0, max: GOAT_FORMAT_RULES.maxSideDeck },
} as const;

/**
 * Cópias permitidas de uma mesma carta.
 *
 * **A banlist não restringe nada aqui.** A lista de abril de 2005 continua
 * visível na carta e no filtro — é informação útil para quem quer montar algo
 * legal —, mas ela deixou de barrar: os decks oficiais que o app já oferece
 * trazem cartas proibidas e sempre puderam ser jogados, então limitar só o
 * deck construído à mão era uma regra que valia para metade do app.
 *
 * As três cópias continuam: esse é o limite base do jogo, não da banlist.
 */
export const MAX_COPIES_PER_CARD = 3;

export function isExtraDeckCard(card: CardDefinition): boolean {
  return (
    card.frameType === "fusion" ||
    card.type.includes("Fusion") ||
    card.type.includes("Synchro") ||
    card.type.includes("Xyz") ||
    card.type.includes("Link")
  );
}

export function getDefaultZone(card: CardDefinition): DeckZone {
  return isExtraDeckCard(card) ? "extra" : "main";
}

export function countInZone(deck: DeckList, zone: DeckZone): number {
  return deck[zone].reduce((sum, ref) => sum + ref.quantity, 0);
}

export function countPasscodeInDeck(deck: DeckList, passcode: Passcode): number {
  return [...deck.main, ...deck.extra, ...deck.side].reduce(
    (sum, ref) => (ref.passcode === passcode ? sum + ref.quantity : sum),
    0,
  );
}

export function buildDeckCountMap(deck: DeckList): Map<Passcode, number> {
  const counts = new Map<Passcode, number>();
  for (const zone of ["main", "extra", "side"] as const) {
    for (const ref of deck[zone]) {
      counts.set(ref.passcode, (counts.get(ref.passcode) ?? 0) + ref.quantity);
    }
  }
  return counts;
}

export type DeckActionResult =
  | { ok: true }
  | { ok: false; reason: string };

export function canAddCard(
  deck: DeckList,
  card: CardDefinition,
  zone: DeckZone,
): DeckActionResult {
  // Sem checagem de banlist: nenhuma carta é proibida aqui (ver
  // `MAX_COPIES_PER_CARD`). O que continua valendo é o limite base de cópias.
  const inDeck = countPasscodeInDeck(deck, card.passcode);
  if (inDeck >= MAX_COPIES_PER_CARD) {
    return {
      ok: false,
      reason: `Limite de ${MAX_COPIES_PER_CARD} cópias atingido.`,
    };
  }

  const zoneTotal = countInZone(deck, zone);
  if (zoneTotal >= DECK_LIMITS[zone].max) {
    return {
      ok: false,
      reason: `${zoneLabel(zone)} cheio (${DECK_LIMITS[zone].max} cartas).`,
    };
  }

  if (zone === "extra" && !isExtraDeckCard(card)) {
    return { ok: false, reason: "Só monstros Fusion vão no Deck Extra." };
  }

  if (zone !== "extra" && isExtraDeckCard(card)) {
    return { ok: false, reason: "Monstros Fusion devem ir no Deck Extra." };
  }

  return { ok: true };
}

export function deckValidationMessages(deck: DeckList): string[] {
  const messages: string[] = [];
  const mainCount = countInZone(deck, "main");

  if (mainCount < DECK_LIMITS.main.min) {
    messages.push(
      `Deck Principal: ${mainCount}/${DECK_LIMITS.main.min} (mínimo 40).`,
    );
  } else if (mainCount > DECK_LIMITS.main.max) {
    messages.push(`Deck Principal excede ${DECK_LIMITS.main.max} cartas.`);
  }

  const sideCount = countInZone(deck, "side");
  if (sideCount > 0 && sideCount < DECK_LIMITS.side.max) {
    messages.push(`Side Deck: ${sideCount}/15 — use 0 ou 15 no Goat.`);
  }

  return messages;
}

export function isDeckDuelReady(deck: DeckList): boolean {
  return deckValidationMessages(deck).length === 0;
}

function zoneLabel(zone: DeckZone): string {
  switch (zone) {
    case "main":
      return "Deck Principal";
    case "extra":
      return "Deck Extra";
    case "side":
      return "Side Deck";
  }
}
