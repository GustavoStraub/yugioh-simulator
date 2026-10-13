import { FORMAT_RULES, formatOf } from "@/lib/types";
import type {
  CardDefinition,
  DeckList,
  DeckZone,
  DuelFormat,
  Passcode,
} from "@/lib/types";

import type { CardRegistry } from "./card-registry";

/** Limites de cada zona do deck no formato. */
export function deckLimits(format: DuelFormat) {
  const rules = FORMAT_RULES[format];
  return {
    main: { min: rules.minMainDeck, max: rules.maxMainDeck },
    extra: { min: 0, max: rules.maxExtraDeck },
    side: { min: 0, max: rules.maxSideDeck },
  } as const;
}

/** Limites do Goat — atalho para quem ainda não sabe o formato (validação de rede antiga). */
export const DECK_LIMITS = deckLimits("goat");

/**
 * Cópias permitidas de uma mesma carta.
 *
 * **A banlist não restringe nada aqui.** A lista do formato (abril de 2005 no
 * Goat, a TCG vigente no TCG) continua visível na carta, no filtro e no resumo
 * do deck — é informação útil para quem quer montar algo legal —, mas ela não
 * barra: os decks oficiais que o app oferece trazem cartas proibidas e sempre
 * puderam ser jogados, então limitar só o deck construído à mão era uma regra
 * que valia para metade do app.
 *
 * As três cópias continuam: esse é o limite base do jogo, não da banlist.
 */
export const MAX_COPIES_PER_CARD = 3;

export function isExtraDeckCard(card: CardDefinition): boolean {
  return (
    card.frameType.startsWith("fusion") ||
    card.frameType.startsWith("synchro") ||
    card.frameType.startsWith("xyz") ||
    card.frameType === "link" ||
    card.type.includes("Fusion") ||
    card.type.includes("Synchro") ||
    card.type.includes("XYZ") ||
    card.type.includes("Xyz") ||
    card.type.includes("Link")
  );
}

/**
 * A carta pertence ao pool do formato?
 *
 * Goat: o pool de abril de 2005. TCG: toda carta TCG que o engine conhece —
 * a lançada depois do snapshot dos dados oficiais (`playable: false`) fica de
 * fora, porque entraria no duelo sem dados nem script.
 */
export function isInFormatPool(card: CardDefinition, format: DuelFormat): boolean {
  if (format === "goat") return card.goat !== false;
  return card.playable !== false;
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
  const format = formatOf(deck.format);
  if (!isInFormatPool(card, format)) {
    return {
      ok: false,
      reason:
        format === "goat"
          ? "Esta carta não existia no Goat Format (abril de 2005)."
          : "Esta carta ainda não tem dados no engine (lançamento recente).",
    };
  }

  // Sem checagem de banlist: nenhuma carta é proibida aqui (ver
  // `MAX_COPIES_PER_CARD`). O que continua valendo é o limite base de cópias.
  const inDeck = countPasscodeInDeck(deck, card.passcode);
  if (inDeck >= MAX_COPIES_PER_CARD) {
    return {
      ok: false,
      reason: `Limite de ${MAX_COPIES_PER_CARD} cópias atingido.`,
    };
  }

  const limits = deckLimits(format);
  const zoneTotal = countInZone(deck, zone);
  if (zoneTotal >= limits[zone].max) {
    return {
      ok: false,
      reason: `${zoneLabel(zone)} cheio (${limits[zone].max} cartas).`,
    };
  }

  if (zone === "extra" && !isExtraDeckCard(card)) {
    return {
      ok: false,
      reason: "Só monstros de Fusão, Sincro, Xyz e Link vão no Deck Extra.",
    };
  }

  if (zone !== "extra" && isExtraDeckCard(card)) {
    return {
      ok: false,
      reason: "Monstros de Fusão, Sincro, Xyz e Link vão no Deck Extra.",
    };
  }

  return { ok: true };
}

export function deckValidationMessages(deck: DeckList): string[] {
  const format = formatOf(deck.format);
  const limits = deckLimits(format);
  const messages: string[] = [];
  const mainCount = countInZone(deck, "main");

  if (mainCount < limits.main.min) {
    messages.push(
      `Deck Principal: ${mainCount}/${limits.main.min} (mínimo ${limits.main.min}).`,
    );
  } else if (mainCount > limits.main.max) {
    messages.push(`Deck Principal excede ${limits.main.max} cartas.`);
  }

  const extraCount = countInZone(deck, "extra");
  if (extraCount > limits.extra.max) {
    messages.push(`Deck Extra excede ${limits.extra.max} cartas.`);
  }

  const sideCount = countInZone(deck, "side");
  if (format === "goat") {
    // Regra de torneio da época: Side Deck de 0 ou exatamente 15.
    if (sideCount > 0 && sideCount < limits.side.max) {
      messages.push(`Side Deck: ${sideCount}/15 — use 0 ou 15 no Goat.`);
    }
  } else if (sideCount > limits.side.max) {
    messages.push(`Side Deck excede ${limits.side.max} cartas.`);
  }

  return messages;
}

export function isDeckDuelReady(deck: DeckList): boolean {
  return deckValidationMessages(deck).length === 0;
}

/**
 * Cartas do deck que não são do pool do formato (ou que o catálogo não
 * conhece). Acontece ao trocar o formato de um deck montado no outro, e num
 * deck antigo com carta que saiu do catálogo. O deck não duela assim: o duelo
 * começaria com uma carta que o formato não tem.
 */
export function cardsOutsidePool(
  deck: DeckList,
  registry: CardRegistry | null,
): Passcode[] {
  if (!registry) return [];
  const format = formatOf(deck.format);
  const fora = new Set<Passcode>();
  for (const zone of ["main", "extra", "side"] as const) {
    for (const ref of deck[zone]) {
      const card = registry.get(ref.passcode);
      if (!card || !isInFormatPool(card, format)) fora.add(ref.passcode);
    }
  }
  return [...fora];
}

/* ---------------- Banlist — só informação ---------------- */

export type BanStatus = "Forbidden" | "Limited" | "Semi-Limited";

/** Quantas cópias a banlist permite por status. */
const BAN_LIMIT: Record<BanStatus, number> = {
  Forbidden: 0,
  Limited: 1,
  "Semi-Limited": 2,
};

/**
 * Situação da carta na banlist DO FORMATO: a de abril de 2005 no Goat, a TCG
 * vigente no TCG. Cada formato lê só a sua lista — antes, carta sem status no
 * Goat caía no `ban_tcg` de hoje e aparecia "proibida em abril/2005" sem ter
 * sido (Cyber-Stein, Dimension Fusion…).
 */
export function banStatus(card: CardDefinition, format: DuelFormat): BanStatus | null {
  return (format === "goat" ? card.banlist?.ban_goat : card.banlist?.ban_tcg) ?? null;
}

/** Nome da lista para a interface. */
export function banlistName(format: DuelFormat): string {
  return format === "goat" ? "lista de abril/2005" : "banlist TCG";
}

export interface BanlistIssue {
  passcode: Passcode;
  status: BanStatus;
  copies: number;
  allowed: number;
}

/**
 * O deck diante da banlist do formato — avisos, nunca bloqueio.
 *
 * @returns as cartas acima do que a lista permite (Proibida com ≥ 1 cópia,
 *   Limitada com ≥ 2, Semi-limitada com 3).
 */
export function banlistIssues(deck: DeckList, registry: CardRegistry | null): BanlistIssue[] {
  if (!registry) return [];
  const format = formatOf(deck.format);
  const issues: BanlistIssue[] = [];
  for (const [passcode, copies] of buildDeckCountMap(deck)) {
    const card = registry.get(passcode);
    const status = card ? banStatus(card, format) : null;
    if (!status) continue;
    const allowed = BAN_LIMIT[status];
    if (copies > allowed) issues.push({ passcode, status, copies, allowed });
  }
  return issues;
}

/** Resumo de uma linha: "Legal na banlist TCG" ou "3 avisos: 1 Proibida, 2 acima do limite". */
export function banlistSummary(deck: DeckList, registry: CardRegistry | null): {
  ok: boolean;
  text: string;
} {
  const format = formatOf(deck.format);
  const issues = banlistIssues(deck, registry);
  if (issues.length === 0) return { ok: true, text: `Legal na ${banlistName(format)}` };
  const proibidas = issues.filter((issue) => issue.status === "Forbidden").length;
  const acima = issues.length - proibidas;
  const partes = [
    proibidas ? `${proibidas} Proibida${proibidas > 1 ? "s" : ""}` : null,
    acima ? `${acima} acima do limite` : null,
  ].filter(Boolean);
  return {
    ok: false,
    text: `${issues.length} aviso${issues.length > 1 ? "s" : ""} na ${banlistName(format)}: ${partes.join(", ")}`,
  };
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
