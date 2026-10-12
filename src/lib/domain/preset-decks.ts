import { randomId } from "@/lib/random-id";
import { formatOf } from "@/lib/types";
import type { DeckCardRef, DeckList, DuelDeckPayload, DuelFormat, Passcode } from "@/lib/types";

export type PresetDeckKind = "starter" | "structure";

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

export function kindLabel(kind: PresetDeckKind): string {
  return kind === "starter" ? "Baralho Inicial" : "Baralha de Estrutura";
}
