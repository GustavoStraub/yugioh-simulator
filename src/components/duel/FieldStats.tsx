"use client";

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

import { StatValue } from "@/components/duel/DuelCardSlot";

/** O ATK/DEF de um monstro de face para cima, e onde ele fica na mesa. */
export interface FieldStat {
  /** `cardKey` da zona — é por ela que o rótulo acha a carta na tela. */
  zoneKey: string;
  atk: number | null;
  def: number | null;
  baseAtk: number | null;
  baseDef: number | null;
  /** Link não tem DEF: só o ATK. */
  isLink: boolean;
  /** Do lado do oponente o número vai EM CIMA da carta (o lado de lá). */
  foeSide: boolean;
}

interface Placed extends FieldStat {
  x: number;
  y: number;
  /** Altura da carta na tela — o tamanho do número acompanha. */
  h: number;
}

/**
 * O ATK/DEF grande do Master Duel, embaixo das suas cartas e em cima das do
 * oponente.
 *
 * Desenhado FORA da mesa inclinada, numa camada plana por cima dela: dentro
 * do plano 3D o número ficava atrás das cartas de pé da fileira da frente (a
 * profundidade decide quem tapa quem, não o `z-index`) e saía cortado ao
 * meio. Aqui ele lê a caixa da carta na tela — `getBoundingClientRect` já
 * devolve a posição projetada — e se põe na borda dela, sempre nítido e
 * sempre por cima, como no jogo.
 */
export function FieldStatsLayer({
  stats,
  fieldRef,
}: {
  stats: FieldStat[];
  fieldRef: RefObject<HTMLDivElement | null>;
}) {
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [tick, setTick] = useState(0);

  // Mede depois de cada render da mesa (o número muda junto com ela) — e de
  // novo um instante depois, quando a carta que acabou de chegar termina de
  // pousar (a animação de chegada mexe na caixa dela).
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const base = field.getBoundingClientRect();
    const proximos: Placed[] = [];
    for (const stat of stats) {
      const slot = field.querySelector<HTMLElement>(`[data-zone="${stat.zoneKey}"]`);
      if (!slot) continue;
      const plano = slot.querySelector<HTMLElement>(".md-card-plane") ?? slot;
      const r = plano.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      proximos.push({
        ...stat,
        x: r.left - base.left + r.width / 2,
        y: stat.foeSide ? r.top - base.top : r.bottom - base.top,
        h: r.height,
      });
    }
    setPlaced((atual) => (mesmasPosicoes(atual, proximos) ? atual : proximos));
  }, [stats, fieldRef, tick]);

  useEffect(() => {
    const timer = setTimeout(() => setTick((t) => t + 1), 480);
    return () => clearTimeout(timer);
  }, [stats]);

  // A janela muda, a mesa muda junto.
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const observador = new ResizeObserver(() => setTick((t) => t + 1));
    observador.observe(field);
    return () => observador.disconnect();
  }, [fieldRef]);

  if (placed.length === 0) return null;
  return (
    <div aria-hidden className="md-stats-layer pointer-events-none absolute inset-0 z-[12]">
      {placed.map((stat) => (
        <span
          key={stat.zoneKey}
          data-stats-for={stat.zoneKey}
          className={`md-stats ${stat.foeSide ? "md-stats-foe" : "md-stats-me"}`}
          style={{
            left: stat.x,
            top: stat.y,
            fontSize: `${Math.max(12, Math.round(stat.h * 0.155))}px`,
          }}
        >
          <StatValue value={stat.atk} base={stat.baseAtk} />
          {!stat.isLink && (
            <span className="md-stats-def">
              /<StatValue value={stat.def} base={stat.baseDef} />
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

function mesmasPosicoes(a: Placed[], b: Placed[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return (
      x.zoneKey === y.zoneKey &&
      x.atk === y.atk &&
      x.def === y.def &&
      x.baseAtk === y.baseAtk &&
      x.baseDef === y.baseDef &&
      Math.abs(x.x - y.x) < 0.5 &&
      Math.abs(x.y - y.y) < 0.5 &&
      Math.abs(x.h - y.h) < 0.5
    );
  });
}
