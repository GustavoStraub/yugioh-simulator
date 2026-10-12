"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { cardKey } from "@/lib/duel/duel-actions";
import { ATTACK_FLIGHT } from "@/lib/duel/pacing";
import type { AttackFlight as AttackFlightData } from "@/hooks/useDuelFeedback";

interface Flight {
  token: number;
  image: string | null;
  /**
   * Rotação que a carta já tinha na zona (180° do lado do oponente, 90° em
   * defesa). O fantasma precisa nascer com ela; sem isso o monstro do
   * oponente "se endireita" ao começar a investida, como se girasse sozinho.
   */
  spin: string;
  /** Posição inicial, em coordenadas do campo. */
  box: { x: number; y: number; w: number; h: number };
  /** Deslocamento do recuo e da investida. */
  windUp: { x: number; y: number };
  lunge: { x: number; y: number };
}

// As durações vêm do módulo de ritmo: o laço de mensagens do duelo precisa
// esperar exatamente este tempo antes de atualizar o tabuleiro.
const {
  windUp: WIND_UP_MS,
  lunge: LUNGE_MS,
  hold: HOLD_MS,
  back: RETURN_MS,
} = ATTACK_FLIGHT;

/**
 * Anima o monstro atacante investindo contra o alvo.
 *
 * Usa a Web Animations API em vez de `transition`: com transição CSS o
 * navegador frequentemente pinta o elemento já com o estilo final (o estado
 * inicial não chega a ser commitado num único frame), e o resultado é a carta
 * "teleportando". Com keyframes explícitos o movimento sempre acontece.
 *
 * A carta para **antes** do alvo, deixando as duas frente a frente, em vez de
 * cobrir a carta atacada.
 */
export function AttackFlightLayer({
  flight,
  fieldRef,
}: {
  flight: AttackFlightData | null;
  fieldRef: RefObject<HTMLDivElement | null>;
}) {
  const [active, setActive] = useState<Flight | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  /**
   * A carta original fica num ref, não no state: escondê-la é uma mutação de
   * DOM, e state em React é para valores lidos no render.
   *
   * Guardamos a **chave da zona** junto: durante o voo o tabuleiro se atualiza
   * e o React pode trocar o elemento daquela zona por outro. Restaurar o
   * elemento antigo (já fora da árvore) deixaria o novo escondido para sempre
   * — um monstro invisível no campo.
   */
  const originRef = useRef<{ element: HTMLElement; zoneKey: string } | null>(null);

  // Mede as posições e monta o voo assim que o ataque é anunciado.
  useEffect(() => {
    const field = fieldRef.current;
    if (!flight || !field) return;

    const zone = (ref: { controller: number; location: number; sequence: number }) =>
      field.querySelector<HTMLElement>(
        `[data-zone="${cardKey(ref.controller, ref.location, ref.sequence)}"]`,
      );

    const originEl = zone(flight.from);
    if (!originEl) return;

    const fieldBox = field.getBoundingClientRect();
    const originBox = originEl.getBoundingClientRect();

    const originCenter = {
      x: originBox.left - fieldBox.left + originBox.width / 2,
      y: originBox.top - fieldBox.top + originBox.height / 2,
    };

    const targetEl = flight.to ? zone(flight.to) : null;
    let targetCenter: { x: number; y: number };

    if (targetEl) {
      const box = targetEl.getBoundingClientRect();
      targetCenter = {
        x: box.left - fieldBox.left + box.width / 2,
        y: box.top - fieldBox.top + box.height / 2,
      };
    } else {
      // Ataque direto: avança em direção à mão do jogador atingido. Quem
      // ataca fica sempre na metade de baixo da tela de quem assiste, então o
      // alvo é o topo quando o ataque é meu, e a base quando é contra mim.
      targetCenter = {
        x: originCenter.x,
        y: flight.mine ? fieldBox.height * 0.06 : fieldBox.height * 0.94,
      };
    }

    const dx = targetCenter.x - originCenter.x;
    const dy = targetCenter.y - originCenter.y;
    const distance = Math.hypot(dx, dy) || 1;

    // Para a uma carta de distância do alvo — assim as duas ficam encaradas,
    // sem uma cobrir a outra.
    const gap = originBox.height * 0.78;
    const travel = Math.max(distance - gap, distance * 0.25);
    const ux = dx / distance;
    const uy = dy / distance;

    originRef.current = {
      element: originEl,
      zoneKey: cardKey(flight.from.controller, flight.from.location, flight.from.sequence),
    };

    // A rotação mora no div interno do slot; copiar dali é mais confiável do
    // que recalcular a partir do estado da carta.
    const giroDoSlot =
      originEl.querySelector<HTMLElement>("[style*='rotate']")?.style.transform ?? "";
    const apenasRotacao = /rotate\((-?[\d.]+)deg\)/.exec(giroDoSlot)?.[0] ?? "";

    setActive({
      token: flight.token,
      image: originEl.querySelector("img")?.getAttribute("src") ?? null,
      spin: apenasRotacao,
      box: {
        x: originBox.left - fieldBox.left,
        y: originBox.top - fieldBox.top,
        w: originBox.width,
        h: originBox.height,
      },
      // Recuo curto no sentido oposto, para dar peso à investida.
      windUp: { x: -ux * originBox.height * 0.16, y: -uy * originBox.height * 0.16 },
      lunge: { x: ux * travel, y: uy * travel },
    });
  }, [flight, fieldRef]);

  // Roda a animação assim que o fantasma existe no DOM.
  useEffect(() => {
    const ghost = ghostRef.current;
    if (!active || !ghost) return;

    // Esconde a carta na zona: sem isso a original e o fantasma aparecem
    // ao mesmo tempo, como se houvesse duas cópias do monstro.
    const origin = originRef.current;
    if (origin) origin.element.style.visibility = "hidden";

    // `transform` é uma propriedade só: a rotação precisa reaparecer em TODOS
    // os quadros, senão o primeiro quadro sem ela já desfaz o giro da carta.
    // Vem depois do translate para o giro continuar sendo em torno do próprio
    // centro — a carta atravessa a mesa sem se endireitar.
    const giro = active.spin ? ` ${active.spin}` : "";
    const total = WIND_UP_MS + LUNGE_MS + HOLD_MS + RETURN_MS;

    const animation = ghost.animate(
      [
        { transform: `translate(0px, 0px)${giro} scale(1)`, offset: 0 },
        {
          transform: `translate(${active.windUp.x}px, ${active.windUp.y}px)${giro} scale(0.96)`,
          offset: WIND_UP_MS / total,
          easing: "ease-out",
        },
        {
          transform: `translate(${active.lunge.x}px, ${active.lunge.y}px)${giro} scale(1.12)`,
          offset: (WIND_UP_MS + LUNGE_MS) / total,
          easing: "cubic-bezier(0.35, 0, 0.2, 1)",
        },
        {
          transform: `translate(${active.lunge.x}px, ${active.lunge.y}px)${giro} scale(1.08)`,
          offset: (WIND_UP_MS + LUNGE_MS + HOLD_MS) / total,
        },
        { transform: `translate(0px, 0px)${giro} scale(1)`, offset: 1, easing: "ease-in" },
      ],
      {
        duration: WIND_UP_MS + LUNGE_MS + HOLD_MS + RETURN_MS,
        fill: "forwards",
      },
    );

    /**
     * Devolve a visibilidade — ao elemento que estiver naquela zona **agora**,
     * não ao que foi escondido. Se o tabuleiro se atualizou durante o voo, são
     * dois elementos diferentes, e limpar só o antigo deixaria a carta sumida.
     */
    const restore = () => {
      if (!origin) return;
      origin.element.style.visibility = "";
      const atual = fieldRef.current?.querySelector<HTMLElement>(
        `[data-zone="${origin.zoneKey}"]`,
      );
      if (atual) atual.style.visibility = "";
    };
    animation.onfinish = () => {
      restore();
      setActive(null);
    };
    return () => {
      animation.cancel();
      restore();
    };
  }, [active, fieldRef]);

  if (!active) return null;

  return (
    <div
      ref={ghostRef}
      key={active.token}
      className="pointer-events-none absolute z-40 overflow-hidden rounded shadow-2xl shadow-black/80 ring-2 ring-red-400"
      style={{
        left: active.box.x,
        top: active.box.y,
        width: active.box.w,
        height: active.box.h,
      }}
    >
      {active.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={active.image} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="tf-card-back h-full w-full" />
      )}
      <span className="absolute inset-0 bg-red-500/20" />
    </div>
  );
}
