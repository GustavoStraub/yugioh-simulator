import { randomId } from "@/lib/random-id";
import { formatOf } from "@/lib/types";
import type { DeckCardRef, DeckList, DuelDeckPayload, DuelFormat, Passcode } from "@/lib/types";

/**
 * Linha de produto. Os decks Goat (montados à mão) só usam as duas primeiras;
 * os TCG (`scripts/build-preset-decks.mjs`) usam todas.
 */
export type PresetDeckKind =
  | "starter"
  | "structure"
  | "egyptian-god"
  | "two-player"
  | "legendary"
  | "box";

/** Ordem das linhas no seletor: dos produtos de entrada às caixas especiais. */
export const PRESET_KIND_ORDER: readonly PresetDeckKind[] = [
  "starter",
  "structure",
  "egyptian-god",
  "two-player",
  "legendary",
  "box",
];

export interface PresetDeckDefinition {
  id: string;
  name: string;
  namePt: string;
  kind: PresetDeckKind;
  year: string;
  sourceUrl: string;
  main: Passcode[];
  extra: Passcode[];
  side: Passcode[];
  /** Formato do produto; ausente = Goat (os decks de 2002–2005). */
  format?: DuelFormat;
  /** Produto de onde o deck veio (uma caixa Legendary tem três decks). */
  product?: string;
  /** Prefixo do set code impresso nas cartas (`SDWD`, `LDK2`). */
  setCode?: string;
}

export function passcodesToRefs(passcodes: Passcode[]): DeckCardRef[] {
  const counts = new Map<Passcode, number>();
  for (const passcode of passcodes) {
    counts.set(passcode, (counts.get(passcode) ?? 0) + 1);
  }

  return [...counts.entries()].map(([passcode, quantity]) => ({
    passcode,
    quantity,
  }));
}

export function presetToDeckList(
  preset: PresetDeckDefinition,
  deckId?: string,
): DeckList {
  return {
    id: deckId ?? randomId(),
    name: preset.namePt,
    format: formatOf(preset.format),
    main: passcodesToRefs(preset.main),
    extra: passcodesToRefs(preset.extra),
    side: passcodesToRefs(preset.side),
    updatedAt: new Date().toISOString(),
  };
}

export function presetCardCount(preset: PresetDeckDefinition): number {
  return preset.main.length + preset.extra.length + preset.side.length;
}

export function presetToDuelPayload(preset: PresetDeckDefinition): DuelDeckPayload {
  return {
    main: preset.main,
    extra: preset.extra,
    side: preset.side,
    format: formatOf(preset.format),
  };
}

const KIND_LABELS: Record<PresetDeckKind, { one: string; many: string }> = {
  starter: { one: "Deck Inicial", many: "Decks Iniciais" },
  structure: { one: "Deck Estrutural", many: "Decks Estruturais" },
  "egyptian-god": { one: "Deck dos Deuses Egípcios", many: "Decks dos Deuses Egípcios" },
  "two-player": { one: "Kit para 2 jogadores", many: "Kits para 2 jogadores" },
  legendary: { one: "Decks Lendários", many: "Decks Lendários" },
  box: { one: "Edição especial", many: "Edições especiais" },
};

export function kindLabel(kind: PresetDeckKind): string {
  return KIND_LABELS[kind]?.one ?? kind;
}

/** Título do grupo no seletor ("Decks Estruturais"). */
export function kindGroupLabel(kind: PresetDeckKind): string {
  return KIND_LABELS[kind]?.many ?? kind;
}

/** Texto em que a busca do seletor procura: nomes, produto e set code, sem acento. */
export function presetSearchText(preset: PresetDeckDefinition): string {
  return normalizeSearch(
    [preset.namePt, preset.name, preset.product, preset.setCode, preset.year].join(" "),
  );
}

export function normalizeSearch(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
