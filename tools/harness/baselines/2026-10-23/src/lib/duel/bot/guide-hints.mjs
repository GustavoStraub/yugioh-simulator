import hints from "../../../data/bot-guide-hints.json" with { type: "json" };
import { deckSignature } from "./deck-profile.mjs";
const BY_SIGNATURE = new Map(hints.map(({ signature, ...hint }) => [signature, hint]));
/** Apenas a lista exata do próprio bot recebe prioridades do guia. */
export function guideHintsForDeck(deck, format) {
    return BY_SIGNATURE.get(deckSignature(deck, format)) ?? null;
}
