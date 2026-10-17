import type { BoardCard, BoardPlayer, ZoneRef } from "@/lib/duel/board-state";
import { cardKey } from "@/lib/duel/duel-actions";

export interface EquipmentLink {
  equipment: BoardCard;
  target: BoardCard;
}

export function zoneKey(zone: ZoneRef): string {
  return cardKey(zone.controller, zone.location, zone.sequence);
}

/** Usa apenas a mesa visível para este jogador, inclusive equipamentos do adversário. */
export function equipmentLinks(players: readonly BoardPlayer[]): EquipmentLink[] {
  const cards = players.flatMap((player) => [...player.monsters, ...player.spells, player.field])
    .filter((card): card is BoardCard => card !== null);
  const byZone = new Map(cards.map((card) => [zoneKey(card), card]));
  return cards.flatMap((equipment) => {
    if (!equipment.code || equipment.faceDown || !equipment.equippedTo) return [];
    const target = byZone.get(zoneKey(equipment.equippedTo));
    return target ? [{ equipment, target }] : [];
  });
}
