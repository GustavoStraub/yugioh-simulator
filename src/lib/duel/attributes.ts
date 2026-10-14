/**
 * Atributo dos monstros: o bit que o core informa ↔ o nome que o catálogo usa
 * ("DARK"), e o kanji do círculo do Master Duel.
 *
 * O atributo da mesa vem do core (`OcgQueryFlags.ATTRIBUTE`), não do catálogo:
 * um efeito que o troca (DNA Surgery, Gozen Match, Ancient Fairy Dragon
 * pedindo um Dragão de LUZ…) só aparece assim.
 */

/** Os bits de `ATTRIBUTE_*` do ygopro-core, na ordem deles. */
const BITS: readonly [number, string][] = [
  [0x01, "EARTH"],
  [0x02, "WATER"],
  [0x04, "FIRE"],
  [0x08, "WIND"],
  [0x10, "LIGHT"],
  [0x20, "DARK"],
  [0x40, "DIVINE"],
];

/**
 * Bits do core → nome do catálogo. Mais de um bit (carta "tratada como todos
 * os atributos") fica com o primeiro — o círculo só tem lugar para um.
 */
export function attributeFromBits(bits: number | null | undefined): string | null {
  if (!bits) return null;
  return BITS.find(([bit]) => (bits & bit) !== 0)?.[1] ?? null;
}

/** O círculo do atributo, com o kanji — como o Master Duel mostra em qualquer idioma. */
export const ATTRIBUTE_KANJI: Record<string, string> = {
  LIGHT: "光",
  DARK: "闇",
  FIRE: "炎",
  WATER: "水",
  WIND: "風",
  EARTH: "地",
  DIVINE: "神",
};
