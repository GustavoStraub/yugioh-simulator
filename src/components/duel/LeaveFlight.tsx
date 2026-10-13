"use client";

import { useEffect, useState, type RefObject } from "react";

import { cardKey } from "@/lib/duel/duel-actions";
import type { LeaveReason } from "@/lib/duel/duel-events";
import type { CardRegistry } from "@/lib/domain/card-registry";
import type { LeaveGhost as LeaveGhostData } from "@/hooks/useDuelFeedback";

/**
 * Cartas saindo do campo: um fantasma da carta se desfaz na zona de onde ela
 * saiu — estilhaço vermelho na destruição, esmaecer violeta no banimento,
 * deslize na volta à mão ou ao Deck.
 *
 * Antes a carta simplesmente sumia e o topo do Cemitério trocava; num Raigeki
 * do oponente o campo esvaziava sem nada dizer o que tinha acontecido.
 *
 * O fantasma é desenhado pela ZONA (que continua na mesa, vazia) e pelo código
 * da carta, não pelo elemento antigo: no online o tabuleiro novo chega antes do
 * evento e a carta já não está mais lá para ser copiada. Carta que saiu sem ser
 * pública (`code` nulo) vira um verso.
 */
export function LeaveFlightLayer({
  leaves,
  fieldRef,
  registry,
  me,
}: {
  leaves: LeaveGhostData[];
  fieldRef: RefObject<HTMLDivElement | null>;
  registry: CardRegistry | null;
  me: 0 | 1;
}) {
  if (leaves.length === 0) return null;
  return (
    <>
      {leaves.map((leave) => (
        <LeaveGhost
          key={leave.token}
          leave={leave}
          fieldRef={fieldRef}
          image={
            leave.code !== null
              ? (registry?.get(leave.code)?.images[0]?.image_url_small ??
                `/card-images/small/${leave.code}.jpg`)
              : null
          }
          upsideDown={leave.from.controller !== me}
          me={me}
        />
      ))}
    </>
  );
}

/** Quadros de cada saída: a forma do movimento diz o motivo. */
function framesFor(why: LeaveReason, spin: string): Keyframe[] {
  switch (why) {
    case "battle":
    case "destroy":
      return [
        { transform: `${spin} scale(1)`, opacity: 1, filter: "brightness(1)" },
        {
          transform: `${spin} scale(1.08)`,
          opacity: 1,
          filter: "brightness(1.9) saturate(0.4)",
          offset: 0.3,
        },
        {
          transform: `${spin} scale(1.28) rotate(7deg)`,
          opacity: 0,
          filter: "brightness(2.2) blur(3px)",
        },
      ];
    case "banish":
      return [
        { transform: `${spin} scale(1)`, opacity: 1, filter: "hue-rotate(0deg)" },
        { transform: `${spin} scale(0.55)`, opacity: 0, filter: "hue-rotate(220deg) brightness(1.6)" },
      ];
    case "hand":
    case "deck":
      return [
        { transform: `${spin} translateY(0%)`, opacity: 1 },
        { transform: `${spin} translateY(28%) scale(0.9)`, opacity: 0 },
      ];
    default:
      // Cemitério, Tributo, matéria: escurece e afunda.
      return [
        { transform: `${spin} scale(1)`, opacity: 1, filter: "brightness(1)" },
        { transform: `${spin} scale(0.88)`, opacity: 0, filter: "brightness(0.4) grayscale(0.6)" },
      ];
  }
}

const TINT: Record<LeaveReason, string> = {
  battle: "ring-red-500 shadow-red-600/70",
  destroy: "ring-red-500 shadow-red-600/70",
  banish: "ring-violet-400 shadow-violet-500/70",
  tribute: "ring-amber-300 shadow-black/70",
  material: "ring-sky-300 shadow-black/70",
  grave: "ring-zinc-400 shadow-black/70",
  hand: "ring-emerald-300 shadow-black/70",
  deck: "ring-emerald-300 shadow-black/70",
};

function LeaveGhost({
  leave,
  fieldRef,
  image,
  upsideDown,
  me,
}: {
  leave: LeaveGhostData;
  fieldRef: RefObject<HTMLDivElement | null>;
  image: string | null;
  upsideDown: boolean;
  me: 0 | 1;
}) {
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [node, setNode] = useState<HTMLDivElement | null>(null);

  // Mede a zona de origem uma vez, ao nascer.
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const { controller, location, sequence } = leave.from;
    const zone =
      field.querySelector<HTMLElement>(`[data-zone="${cardKey(controller, location, sequence)}"]`) ??
      // Zona de Monstro Extra vazia: a mesa a identifica pelo assento de quem
      // olha (a da esquerda é a 5 de `me` e a 6 do oponente).
      (sequence >= 5
        ? field.querySelector<HTMLElement>(`[data-zone="${cardKey(me, location, 11 - sequence)}"]`)
        : null);
    if (!zone) return;
    const fieldBox = field.getBoundingClientRect();
    const zoneBox = zone.getBoundingClientRect();
    setBox({
      x: zoneBox.left - fieldBox.left,
      y: zoneBox.top - fieldBox.top,
      w: zoneBox.width,
      h: zoneBox.height,
    });
  }, [leave, fieldRef, me]);

  useEffect(() => {
    if (!node) return;
    const animation = node.animate(framesFor(leave.why, upsideDown ? "rotate(180deg)" : ""), {
      duration: leave.duration,
      easing: "cubic-bezier(0.3, 0, 0.3, 1)",
      fill: "forwards",
    });
    return () => animation.cancel();
  }, [node, leave, upsideDown]);

  if (!box) return null;

  return (
    <div
      ref={setNode}
      data-leave-ghost={leave.why}
      className={`pointer-events-none absolute z-30 overflow-hidden rounded-[4px] shadow-xl ring-2 ${TINT[leave.why]}`}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="tf-card-back h-full w-full" />
      )}
    </div>
  );
}
