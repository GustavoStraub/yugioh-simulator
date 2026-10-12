import presetDecksData from "@/data/preset-decks.json";
import type { PresetDeckDefinition } from "@/lib/domain/preset-decks";

export const PRESET_DECKS = presetDecksData as PresetDeckDefinition[];

export function getPresetDeck(id: string): PresetDeckDefinition | undefined {
  return PRESET_DECKS.find((preset) => preset.id === id);
}

export function getPresetsByKind(kind: PresetDeckDefinition["kind"]) {
  return PRESET_DECKS.filter((preset) => preset.kind === kind);
}
