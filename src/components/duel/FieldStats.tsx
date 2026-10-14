"use client";

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

import { StatValue } from "@/components/duel/DuelCardSlot";
import { ATTRIBUTE_KANJI } from "@/lib/duel/attributes";
import { attributeLabel } from "@/lib/card-labels";

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
  /**
   * Atributo atual ("DARK"…) e o impresso. Os dois porque um efeito pode
   * trocá-lo (DNA Surgery), e a troca tem de aparecer.
   */
  attribute: string | null;
  baseAttribute: string | null;
  /** Nível, Rank ou Link atual, e o impresso — também mudam por efeito. */
  grade: FieldGrade | null;
}

export interface FieldGrade {
  kind: "level" | "rank" | "link";
  value: number;
  base: number | null;
  /** Regulador: o "R" decide a Invocação-Sincro e tem de se achar de relance. */
  tuner: boolean;
}

interface Placed extends FieldStat {
  x: number;
  y: number;
  /** Altura da carta na tela — o tamanho do número acompanha. */
  h: number;
  /** Onde vão o atributo e o Nível: no canto da carta do lado do ATK/DEF. */
  tagX: number;
  tagY: number;
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
        // Como no MD: o círculo do atributo sobre o canto da carta e o Nível
        // passando da borda dela, no mesmo lado do ATK/DEF.
        tagX: r.left - base.left + r.width * 0.56,
        tagY: stat.foeSide ? r.top - base.top + r.height * 0.05 : r.bottom - base.top - r.height * 0.05,
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
      {placed.map((stat) =>
        stat.attribute || stat.grade ? (
          <span
            key={`tags:${stat.zoneKey}`}
            data-tags-for={stat.zoneKey}
            className={`md-tags ${stat.foeSide ? "md-tags-foe" : "md-tags-me"}`}
            style={{
              left: stat.tagX,
              top: stat.tagY,
              fontSize: `${Math.max(10, Math.round(stat.h * 0.13))}px`,
            }}
          >
            {stat.attribute && <AttributeTag attribute={stat.attribute} base={stat.baseAttribute} />}
            {stat.grade && <GradeTag grade={stat.grade} />}
          </span>
        ) : null,
      )}
    </div>
  );
}

/** O círculo do atributo com o kanji; trocado por efeito, ganha um anel. */
function AttributeTag({ attribute, base }: { attribute: string; base: string | null }) {
  const trocado = Boolean(base && base !== attribute);
  return (
    <span
      data-attribute-tag={attribute}
      data-attribute-changed={trocado ? "1" : undefined}
      className={`md-attr md-tag-attr md-attr-${attribute.toLowerCase()} ${trocado ? "md-tag-changed" : ""}`}
      title={
        trocado
          ? `${attributeLabel(attribute)} (original: ${attributeLabel(base ?? undefined)})`
          : (attributeLabel(attribute) ?? undefined)
      }
    >
      {ATTRIBUTE_KANJI[attribute] ?? "?"}
    </span>
  );
}

/** A estrela (ou a do Rank, ou o losango do Link) e o número atual. */
function GradeTag({ grade }: { grade: FieldGrade }) {
  const nome = grade.kind === "link" ? "Link" : grade.kind === "rank" ? "Rank" : "Nível";
  return (
    <span
      data-level-badge={grade.kind}
      className={`md-tag-grade md-level-${grade.kind === "level" ? "star" : grade.kind} ${
        grade.tuner ? "md-level-tuner" : ""
      }`}
      title={`${nome} ${grade.value}${grade.tuner ? " — Regulador" : ""}`}
    >
      <span aria-hidden className="md-level-icon" />
      <StatValue value={grade.value} base={grade.base} />
      {grade.tuner && <span className="md-tag-tuner">R</span>}
    </span>
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
      x.attribute === y.attribute &&
      x.baseAttribute === y.baseAttribute &&
      x.grade?.kind === y.grade?.kind &&
      x.grade?.value === y.grade?.value &&
      x.grade?.base === y.grade?.base &&
      x.grade?.tuner === y.grade?.tuner &&
      Math.abs(x.x - y.x) < 0.5 &&
      Math.abs(x.y - y.y) < 0.5 &&
      Math.abs(x.h - y.h) < 0.5 &&
      Math.abs(x.tagX - y.tagX) < 0.5 &&
      Math.abs(x.tagY - y.tagY) < 0.5
    );
  });
}
