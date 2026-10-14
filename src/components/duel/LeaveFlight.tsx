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

/**
 * Os cacos da carta destruída: uma grade irregular de quadriláteros (em % da
 * carta) que cobre a carta inteira. Cada um voa para fora do centro, girando.
 */
const CACOS: [number, number][][] = (() => {
  const xs = [
    [0, 35, 68, 100],
    [0, 40, 72, 100],
    [0, 30, 62, 100],
    [0, 42, 70, 100],
    [0, 33, 66, 100],
  ];
  const ys = [
    [0, 0, 0, 0],
    [30, 24, 32, 26],
    [52, 58, 50, 57],
    [78, 82, 76, 84],
    [100, 100, 100, 100],
  ];
  const cacos: [number, number][][] = [];
  for (let linha = 0; linha < 4; linha += 1) {
    for (let coluna = 0; coluna < 3; coluna += 1) {
      cacos.push([
        [xs[linha][coluna], ys[linha][coluna]],
        [xs[linha][coluna + 1], ys[linha][coluna + 1]],
        [xs[linha + 1][coluna + 1], ys[linha + 1][coluna + 1]],
        [xs[linha + 1][coluna], ys[linha + 1][coluna]],
      ]);
    }
  }
  return cacos;
})();

/**
 * A destruição do Master Duel: a carta trinca e se estilhaça — os cacos voam
 * do centro para fora, girando e apagando, com um clarão no meio.
 */
function Estilhaco({ image, duration }: { image: string | null; duration: number }) {
  return (
    <span className="md-shatter" style={{ ["--md-shatter-ms" as string]: `${duration}ms` }}>
      <span className="md-shatter-flash" />
      {CACOS.map((caco, index) => {
        const cx = caco.reduce((t, [x]) => t + x, 0) / 4;
        const cy = caco.reduce((t, [, y]) => t + y, 0) / 4;
        // Para fora do centro da carta, mais longe quanto mais na borda; um
        // giro diferente para cada caco (determinístico — sem `Math.random`
        // no render).
        const dx = (cx - 50) * 1.6;
        const dy = (cy - 50) * 1.3 + 10;
        const giro = ((index * 47) % 90) - 45;
        return (
          <span
            key={index}
            className={`md-shard ${image ? "" : "tf-card-back"}`}
            style={{
              clipPath: `polygon(${caco.map(([x, y]) => `${x}% ${y}%`).join(", ")})`,
              backgroundImage: image ? `url("${image}")` : undefined,
              ["--md-dx" as string]: `${dx}%`,
              ["--md-dy" as string]: `${dy}%`,
              ["--md-rot" as string]: `${giro}deg`,
              animationDelay: `${(index % 4) * 14}ms`,
            }}
          />
        );
      })}
    </span>
  );
}

function LeaveGhost({
  leave,
  fieldRef,
  image,
  me,
}: {
  leave: LeaveGhostData;
  fieldRef: RefObject<HTMLDivElement | null>;
  image: string | null;
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
    // A carta estava de pé sobre a zona (ver `.md-standing`): um pouco mais
    // alta na tela que a zona deitada — o fantasma nasce do tamanho dela.
    const alta = location === 4 || location === 8 ? zoneBox.height * 0.1 : 0;
    setBox({
      x: zoneBox.left - fieldBox.left,
      y: zoneBox.top - fieldBox.top - alta,
      w: zoneBox.width,
      h: zoneBox.height + alta,
    });
  }, [leave, fieldRef, me]);

  const estilhaca = leave.why === "battle" || leave.why === "destroy";

  useEffect(() => {
    if (!node || estilhaca) return;
    const animation = node.animate(framesFor(leave.why, ""), {
      duration: leave.duration,
      easing: "cubic-bezier(0.3, 0, 0.3, 1)",
      fill: "forwards",
    });
    return () => animation.cancel();
  }, [node, leave, estilhaca]);

  if (!box) return null;

  if (estilhaca) {
    return (
      <div
        data-leave-ghost={leave.why}
        className="pointer-events-none absolute z-30"
        style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      >
        <Estilhaco image={image} duration={leave.duration} />
      </div>
    );
  }

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
