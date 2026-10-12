import { OcgLocation, type SelectFieldPlace } from "@n1xx1/ocgcore-wasm";

/**
 * Zonas que existem de fato em cada grupo do `field_mask`.
 *
 * - Monstro: 0–4 são as principais, 5–6 as **Zonas de Monstro Extra** (Master
 *   Rule 4/5). No Goat o core sempre marca 5–6 como indisponíveis, então
 *   decodificar as sete não muda nada lá.
 * - Magia/Armadilha: 0–4, mais a **Zona de Campo** (5). Os bits 6–7 são as
 *   Zonas de Pêndulo da Master Rule 3, que nenhum formato do app usa — desde a
 *   MR4 o Pêndulo mora nas zonas 0 e 4.
 *
 * Ler só cinco por grupo, como antes, escondia da tela as Zonas Extra que o
 * engine oferecia: uma Invocação-Link (que SÓ pode ir para a Zona Extra, ou
 * para onde outro Link aponta) virava uma pergunta sem resposta possível, e o
 * duelo congelava.
 */
const MONSTER_ZONES = 7;
const SPELL_ZONES = 6;

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
 * bits  0..6   → zonas de monstro DE QUEM foi perguntado (5–6 = Zonas Extra)
 * bits  8..13  → magia/armadilha de quem foi perguntado (13 = Zona de Campo)
 * bits 16..22  → zonas de monstro do oponente
 * bits 24..29  → magia/armadilha do oponente
 * ```
 */
export function decodeFieldMask(
  fieldMask: number,
  /** O `player` da mensagem — a máscara é lida a partir da ótica dele. */
  askedPlayer: number,
): SelectFieldPlace[] {
  const places: SelectFieldPlace[] = [];
  const opponent = askedPlayer === 0 ? 1 : 0;

  const groups: {
    base: number;
    player: number;
    location: OcgLocation;
    count: number;
  }[] = [
    { base: 0, player: askedPlayer, location: OcgLocation.MZONE, count: MONSTER_ZONES },
    { base: 8, player: askedPlayer, location: OcgLocation.SZONE, count: SPELL_ZONES },
    { base: 16, player: opponent, location: OcgLocation.MZONE, count: MONSTER_ZONES },
    { base: 24, player: opponent, location: OcgLocation.SZONE, count: SPELL_ZONES },
  ];

  for (const group of groups) {
    for (let sequence = 0; sequence < group.count; sequence += 1) {
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

/** Zona de Monstro Extra? (índices 5 e 6 da MZONE) */
export function isExtraMonsterZone(location: number, sequence: number): boolean {
  return location === OcgLocation.MZONE && sequence >= 5;
}

export function fieldPlaceLabel(place: SelectFieldPlace, viewer: number): string {
  const side = place.player === viewer ? "Você" : "Oponente";
  if (place.location === OcgLocation.MZONE) {
    return isExtraMonsterZone(place.location, place.sequence)
      ? `${side} · Zona Extra`
      : `${side} · Monstro ${place.sequence + 1}`;
  }
  if (place.location === OcgLocation.SZONE) {
    return place.sequence === 5
      ? `${side} · Zona de Campo`
      : `${side} · Magia/Armadilha ${place.sequence + 1}`;
  }
  return `${side} · Zona`;
}
