import goatPresets from "@/data/preset-decks.json";
import tcgPresets from "@/data/preset-decks-tcg.json";
import type { PresetDeckDefinition } from "@/lib/domain/preset-decks";

/**
 * Todos os decks prontos, dos dois formatos.
 *
 * - `preset-decks.json`: os 10 decks Goat (2002–2005), montados à mão.
 * - `preset-decks-tcg.json`: os ~100 produtos do TCG, gerados por
 *   `npm run build:presets` a partir das listas da Yugipedia — não editar à
 *   mão, rodar o script de novo.
 *
 * Os dez produtos Goat também aparecem na lista TCG (com ids `tcg-…`): é o
 * mesmo deck, jogado com as regras de hoje. As duas listas batem carta a carta
 * (só muda a arte escolhida de algumas cartas).
 */
export const PRESET_DECKS = [
  ...(goatPresets as PresetDeckDefinition[]),
  ...(tcgPresets as PresetDeckDefinition[]),
];

export function getPresetDeck(id: string): PresetDeckDefinition | undefined {
  return PRESET_DECKS.find((preset) => preset.id === id);
}

export function getPresetsByKind(kind: PresetDeckDefinition["kind"]) {
  return PRESET_DECKS.filter((preset) => preset.kind === kind);
}
