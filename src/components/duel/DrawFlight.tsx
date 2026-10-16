"use client";

import { useEffect, useState, type RefObject } from "react";

import type { DrawFlight as DrawFlightData } from "@/hooks/useDuelFeedback";

interface Ghost {
  id: string;
  from: { x: number; y: number; w: number; h: number };
  to: { x: number; y: number };
  delay: number;
  /** Duração do voo, já na velocidade escolhida. */
  travel: number;
}

const TRAVEL_MS = 380;
const STAGGER_MS = 110;

/**
 * Mostra a carta saindo do deck e indo para a mão.
 *
 * A compra muda a mão instantaneamente; sem um movimento visível não dá para
 * perceber que alguém comprou — muito menos no turno do oponente.
 */
export function DrawFlightLayer({
  draw,
  fieldRef,
}: {
  draw: DrawFlightData | null;
  fieldRef: RefObject<HTMLDivElement | null>;
}) {
  const [ghosts, setGhosts] = useState<Ghost[]>([]);

  useEffect(() => {
    const field = fieldRef.current;
    if (!draw || !field) return;

    const deckEl = field.querySelector<HTMLElement>(
      `[data-pile="deck-${draw.player}"]`,
    );
    const handEl = field.querySelector<HTMLElement>(
      `[data-hand="${draw.player}"]`,
    );
    if (!deckEl || !handEl) return;

    const fieldBox = field.getBoundingClientRect();
    const deckBox = (deckEl.querySelector(".md-pile-stack") ?? deckEl).getBoundingClientRect();
    const handBox = handEl.getBoundingClientRect();

    const from = {
      x: deckBox.left - fieldBox.left,
      y: deckBox.top - fieldBox.top,
      w: deckBox.width,
      h: deckBox.height,
    };

    /**
     * Onde cada carta comprada realmente vai parar.
     *
     * A mão já foi atualizada quando esta animação começa, então dá para mirar
     * na carta de verdade em vez de num ponto calculado: as `count` últimas
     * posições da mão são exatamente as que acabaram de chegar. Mirar no meio
     * da mão — o que se fazia antes — deixava a carta pousando num lugar onde
     * ela não está, e o olho perdia qual carta foi comprada.
     */
    // Só as cartas: a contagem ao lado da mão do oponente (`data-hand-count`)
    // também é filha dela, e o voo pousava no número.
    const slots = [...handEl.children].filter(
      (node): node is HTMLElement =>
        node instanceof HTMLElement && !node.hasAttribute("data-hand-count"),
    );
    const chegando = slots.slice(-draw.count);

    const created: Ghost[] = Array.from({ length: draw.count }, (_, index) => {
      const destino = chegando[index];
      let to: { x: number; y: number };

      if (destino) {
        const box = destino.getBoundingClientRect();
        to = {
          x: box.left - fieldBox.left + box.width / 2,
          y: box.top - fieldBox.top + box.height / 2,
        };
      } else {
        // Mão do oponente (só versos, sem slot próprio) ou uma compra que a
        // tela ainda não refletiu: cai no espalhamento em torno do centro.
        const spread = (index - (draw.count - 1) / 2) * (from.w * 0.7);
        to = {
          x: handBox.left - fieldBox.left + handBox.width / 2 + spread,
          y: handBox.top - fieldBox.top + handBox.height / 2,
        };
      }

      return {
        id: `${draw.token}-${index}`,
        from,
        to,
        delay: Math.round(index * STAGGER_MS * draw.scale),
        travel: Math.max(1, Math.round(TRAVEL_MS * draw.scale)),
      };
    });

    setGhosts(created);
    const done = setTimeout(
      () => setGhosts([]),
      (TRAVEL_MS + created.length * STAGGER_MS) * draw.scale + 80,
    );
    return () => clearTimeout(done);
  }, [draw, fieldRef]);

  if (ghosts.length === 0) return null;

  return (
    <>
      {ghosts.map((ghost) => (
        <DrawGhost key={ghost.id} ghost={ghost} />
      ))}
    </>
  );
}

function DrawGhost({ ghost }: { ghost: Ghost }) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);

  // Web Animations API, e não `transition`, pelo mesmo motivo do ataque: com
  // transição CSS o navegador pode pintar direto no estado final.
  useEffect(() => {
    if (!node) return;

    const dx = ghost.to.x - (ghost.from.x + ghost.from.w / 2);
    const dy = ghost.to.y - (ghost.from.y + ghost.from.h / 2);

    const animation = node.animate(
      [
        { transform: "translate(0px, 0px) scale(0.9)", opacity: 0 },
        { transform: "translate(0px, 0px) scale(1)", opacity: 1, offset: 0.12 },
        {
          transform: `translate(${dx}px, ${dy}px) scale(0.85)`,
          opacity: 0.9,
          offset: 1,
        },
      ],
      {
        duration: ghost.travel,
        delay: ghost.delay,
        fill: "both",
        easing: "cubic-bezier(0.3, 0, 0.2, 1)",
      },
    );

    return () => animation.cancel();
  }, [node, ghost]);

  return (
    <div
      ref={setNode}
      className="tf-card-back pointer-events-none absolute z-40 rounded shadow-xl shadow-black/70"
      style={{
        left: ghost.from.x,
        top: ghost.from.y,
        width: ghost.from.w,
        height: ghost.from.h,
        opacity: 0,
      }}
    />
  );
}
