import { invalidateClientSnapshot } from "@/hooks/useClientSnapshot";
import type { CardDefinition } from "@/lib/types";

/**
 * Idioma em que as cartas são lidas.
 *
 * Só as CARTAS: a interface segue em português. Quem joga Goat aprendeu os
 * nomes em inglês (é assim que os decks são discutidos e é assim que as listas
 * chegam de fora), mas o texto do efeito em português é o que se lê para
 * decidir a jogada. Deixar escolher resolve os dois sem obrigar a nenhum.
 */
export const LANGUAGE_STORAGE_KEY = "yugioh-goat-language-v1";

export type Language = "pt" | "en";

export const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: "pt", label: "PT" },
  { value: "en", label: "EN" },
];

export function loadLanguage(): Language {
  if (typeof window === "undefined") return "pt";
  return localStorage.getItem(LANGUAGE_STORAGE_KEY) === "en" ? "en" : "pt";
}

export function saveLanguage(language: Language): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  invalidateClientSnapshot(LANGUAGE_STORAGE_KEY);
}

/**
 * Nome da carta no idioma escolhido.
 *
 * Cai para o outro idioma quando falta tradução: a YGOPRODeck não publica
 * português para todas as cartas, e sumir com o nome é pior do que mostrá-lo
 * em inglês.
 */
export function cardName(card: CardDefinition, language: Language): string {
  if (language === "en") return card.nameEn ?? card.name;
  return card.name;
}

/** Texto do efeito no idioma escolhido, com a mesma queda de volta. */
export function cardDesc(card: CardDefinition, language: Language): string {
  if (language === "en") return card.descEn ?? card.desc;
  return card.desc;
}
