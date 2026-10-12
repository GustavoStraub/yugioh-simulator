import { OcgLocation } from "@n1xx1/ocgcore-wasm";

import type { BoardCard, BoardState } from "@/lib/duel/board-state";

/**
 * Para onde as setas de cada Link apontam — a geometria da mesa de Master Rule
 * 2020, em coordenadas absolutas (jogador 0 embaixo).
 *
 * ```
 *   y=2   [p1 4] [p1 3] [p1 2] [p1 1] [p1 0]     ← principais do jogador 1
 *   y=1          [EMZ e]       [EMZ d]           ← x=1 e x=3
 *   y=0   [p0 0] [p0 1] [p0 2] [p0 3] [p0 4]     ← principais do jogador 0
 *          x=0    x=1    x=2    x=3    x=4
 * ```
 *
 * Três detalhes que é fácil errar:
 *
 * - As Zonas Extra são compartilhadas: a esquerda (vista do jogador 0) é a
 *   zona 5 dele e a zona **6** do jogador 1.
 * - As zonas principais do jogador 1 são espelhadas (a zona 0 dele fica em
 *   x=4 na ótica do jogador 0).
 * - As setas são da carta, na orientação de quem a controla: um Link do
 *   jogador 1 está de cabeça para baixo, e a seta "para baixo" dele aponta para
 *   o lado do jogador 0.
 *
 * Seta para uma coordenada sem zona (ao lado de uma Zona Extra, fora da
 * mesa) não aponta para nada — é a regra.
 */

/** Bits do `OcgLinkMarker` → direção na orientação de quem controla. */
const ARROWS: [number, number, number][] = [
  [0x001, -1, -1], // baixo-esquerda
  [0x002, 0, -1], // baixo
  [0x004, 1, -1], // baixo-direita
  [0x008, -1, 0], // esquerda
  [0x020, 1, 0], // direita
  [0x040, -1, 1], // cima-esquerda
  [0x080, 0, 1], // cima
  [0x100, 1, 1], // cima-direita
];

export interface ZoneRef {
  controller: 0 | 1;
  sequence: number;
}

/** Coordenada absoluta de uma zona de monstro. */
export function zoneCoord(zone: ZoneRef): { x: number; y: number } {
  if (zone.sequence <= 4) {
    return zone.controller === 0
      ? { x: zone.sequence, y: 0 }
      : { x: 4 - zone.sequence, y: 2 };
  }
  // Zona Extra: a 5 do jogador 0 e a 6 do jogador 1 são a mesma (x=1).
  const left = (zone.controller === 0) === (zone.sequence === 5);
  return { x: left ? 1 : 3, y: 1 };
}

/**
 * As zonas que existem numa coordenada. Na fileira do meio são DUAS
 * identidades (a zona 5 de um, a 6 do outro) para o mesmo lugar físico —
 * devolver as duas deixa quem consulta casar com o ocupante, seja de quem for.
 */
function zonesAt(x: number, y: number): ZoneRef[] {
  if (x < 0 || x > 4) return [];
  if (y === 0) return [{ controller: 0, sequence: x }];
  if (y === 2) return [{ controller: 1, sequence: 4 - x }];
  if (y === 1 && (x === 1 || x === 3)) {
    return x === 1
      ? [{ controller: 0, sequence: 5 }, { controller: 1, sequence: 6 }]
      : [{ controller: 0, sequence: 6 }, { controller: 1, sequence: 5 }];
  }
  return [];
}

/** Zonas para onde um Link nesta zona aponta. */
export function pointedZones(zone: ZoneRef, markers: number): ZoneRef[] {
  const { x, y } = zoneCoord(zone);
  const flip = zone.controller === 1 ? -1 : 1;
  const out: ZoneRef[] = [];
  for (const [bit, dx, dy] of ARROWS) {
    if ((markers & bit) === 0) continue;
    out.push(...zonesAt(x + dx * flip, y + dy * flip));
  }
  return out;
}

/** Chave `controller:location:sequence`, a mesma do `cardKey` da mesa. */
function keyOf(zone: ZoneRef): string {
  return `${zone.controller}:${OcgLocation.MZONE}:${zone.sequence}`;
}

/**
 * Toda zona de monstro apontada por algum Link em campo, com os passcodes de
 * quem aponta.
 *
 * A chave é a da zona (`cardKey`); para uma Zona Extra vêm as duas identidades,
 * porque a mesa desenha o ocupante pela dele.
 */
export function linkedZones(board: BoardState): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (const player of board.players) {
    player.monsters.forEach((card: BoardCard | null) => {
      if (!card?.link || card.code === null) return;
      const from: ZoneRef = { controller: card.controller, sequence: card.sequence };
      for (const zone of pointedZones(from, card.link.markers)) {
        const key = keyOf(zone);
        result.set(key, [...(result.get(key) ?? []), card.code]);
      }
    });
  }
  return result;
}
