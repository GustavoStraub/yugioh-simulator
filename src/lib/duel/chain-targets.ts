import { OcgLocation } from "@n1xx1/ocgcore-wasm";
import type { BoardCard, BoardPlayer } from "@/lib/duel/board-state";
import type { DuelZoneRef } from "@/lib/duel/duel-events";
import type { DuelChainLink, DuelChainTarget } from "@/lib/duel/duel-session";

export const chainZoneKey = (zone: DuelZoneRef) => `${zone.controller}:${zone.location}:${zone.sequence}`;
export const isLiveChainLink = (link: DuelChainLink) => link.state === "pending" || link.state === "resolving";

export function chainTargetLabel(target: DuelChainTarget, me: number, name: (code: number) => string, players?: readonly BoardPlayer[]): string {
  const { controller, location, sequence } = target.zone;
  const side = controller === me ? "Você" : "Oponente";
  const player = players?.[controller];
  const current: BoardCard | null | undefined = target.present && player
    ? location === OcgLocation.MZONE ? player.monsters[sequence]
      : location === OcgLocation.SZONE ? sequence === 5 ? player.field : player.spells[sequence]
        : location === OcgLocation.GRAVE ? player.grave[sequence] : undefined
    : undefined;
  const code = target.code ?? current?.code;
  const title = code ? name(code) : "Carta baixada";
  const place = location === OcgLocation.MZONE ? `Monstro ${sequence + 1}`
    : location === OcgLocation.SZONE ? sequence === 5 ? "Campo" : `Magia/Armadilha ${sequence + 1}`
      : location === OcgLocation.GRAVE ? "Cemitério" : location === OcgLocation.REMOVED ? "Banidas" : "Carta";
  return `${title} · ${side} · ${place}${target.present ? "" : " · saiu do local"}`;
}
