import { OcgLocation, type SelectFieldPlace } from "@n1xx1/ocgcore-wasm";

/**
 * Decodifica o `field_mask` de SELECT_PLACE / SELECT_DISFIELD.
 *
 * Dois detalhes que o formato tem e que é fácil errar:
 *
 * 1. O bit **setado** marca zona INDISPONÍVEL. Máscara `0xffffffe0` (bits 0-4
 *    zerados) significa "as 5 zonas de monstro estão livres".
 * 2. O layout é **relativo ao jogador perguntado** (`msg.player`), não
 *    absoluto. A mesma máscara chega para os dois jogadores; os bits baixos
 *    sempre descrevem as zonas de quem está sendo perguntado.
 *
 * ```
 * bits  0..4   → zonas de monstro DE QUEM foi perguntado
 * bits  8..12  → zonas de magia/armadilha de quem foi perguntado
 * bits 16..20  → zonas de monstro do oponente
 * bits 24..28  → zonas de magia/armadilha do oponente
 * ```
 */
export function decodeFieldMask(
  fieldMask: number,
  /** O `player` da mensagem — a máscara é lida a partir da ótica dele. */
  askedPlayer: number,
): SelectFieldPlace[] {
  const places: SelectFieldPlace[] = [];
  const opponent = askedPlayer === 0 ? 1 : 0;

  const groups: { base: number; player: number; location: OcgLocation }[] = [
    { base: 0, player: askedPlayer, location: OcgLocation.MZONE },
    { base: 8, player: askedPlayer, location: OcgLocation.SZONE },
    { base: 16, player: opponent, location: OcgLocation.MZONE },
    { base: 24, player: opponent, location: OcgLocation.SZONE },
  ];

  for (const group of groups) {
    for (let sequence = 0; sequence < 5; sequence += 1) {
      if ((fieldMask & (1 << (group.base + sequence))) === 0) {
        places.push({
          player: group.player,
          location: group.location,
          sequence,
        });
      }
    }
  }

  return places;
}

/**
 * Escolhe as `count` primeiras zonas livres, preferindo as do próprio jogador.
 * Se o mask não deixar nada livre devolve um fallback para não travar o duelo.
 */
export function pickFieldPlaces(
  fieldMask: number,
  player: number,
  count: number,
): SelectFieldPlace[] {
  const available = decodeFieldMask(fieldMask, player);
  const mine = available.filter((place) => place.player === player);
  const ordered = [...mine, ...available.filter((place) => place.player !== player)];

  if (ordered.length === 0) {
    return [{ player, location: OcgLocation.MZONE, sequence: 0 }];
  }

  return ordered.slice(0, Math.max(count, 1));
}

const LOCATION_LABEL: Record<number, string> = {
  [OcgLocation.MZONE]: "Monstro",
  [OcgLocation.SZONE]: "Magia/Armadilha",
};

export function fieldPlaceLabel(place: SelectFieldPlace, viewer: number): string {
  const zone = LOCATION_LABEL[place.location] ?? "Zona";
  const side = place.player === viewer ? "Você" : "Oponente";
  return `${side} · ${zone} ${place.sequence + 1}`;
}
