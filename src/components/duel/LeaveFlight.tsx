"use client";

import { OcgLocation } from "@n1xx1/ocgcore-wasm";
import { useEffect, useState, type RefObject } from "react";

import {
  hologramAnchor,
  hologramUrl,
  hologramWasLit,
  type HologramIndexView,
} from "@/components/duel/MonsterHolograms";
import { cardKey } from "@/lib/duel/duel-actions";
import type { DuelZoneRef, LeaveReason } from "@/lib/duel/duel-events";
import type { HologramMode } from "@/lib/duel/duel-prefs";
import type { CardRegistry } from "@/lib/domain/card-registry";
import type { LeaveGhost as LeaveGhostData } from "@/hooks/useDuelFeedback";

/**
 * Cartas saindo do campo, como no Master Duel: a carta VOA da zona até a
 * pilha de destino — Cemitério, banidas, Deck, Extra Deck, mão, o monstro Xyz
 * de quem virou matéria —, e a pilha acende quando ela chega. Destruída, ela
 * se estilhaça na zona (e a pilha do Cemitério acende depois); com holograma,
 * o holograma se estilhaça primeiro e a carta logo em seguida, em cadeia.
 *
 * Antes a carta se desfazia na própria zona e o topo do Cemitério trocava: dava
 * para ver que algo saiu, não para onde foi.
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
  holoIndex,
  holoMode,
}: {
  leaves: LeaveGhostData[];
  fieldRef: RefObject<HTMLDivElement | null>;
  registry: CardRegistry | null;
  me: 0 | 1;
  /** Quem tem holograma — a destruição dele estilhaça o holograma antes. */
  holoIndex: HologramIndexView | null;
  holoMode: HologramMode;
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
          holo={
            holoIndex && holoMode !== "off" && leave.code !== null && holoIndex.kinds.has(leave.code)
              ? { url: hologramUrl(holoIndex, leave.code), layers: holoIndex.layers, mode: holoMode }
              : null
          }
        />
      ))}
    </>
  );
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A zona do campo de uma carta — a Zona Extra vazia pelo assento de quem olha. */
function zoneElement(field: HTMLElement, ref: DuelZoneRef, me: 0 | 1): HTMLElement | null {
  const { controller, location, sequence } = ref;
  return (
    field.querySelector<HTMLElement>(`[data-zone="${cardKey(controller, location, sequence)}"]`) ??
    // Zona de Monstro Extra vazia: a mesa a identifica pelo assento de quem
    // olha (a da esquerda é a 5 de `me` e a 6 do oponente).
    (sequence >= 5
      ? field.querySelector<HTMLElement>(`[data-zone="${cardKey(me, location, 11 - sequence)}"]`)
      : null)
  );
}

/**
 * Onde a carta pousa: a pilha (`data-pile`), a mão (`data-hand`) ou — matéria
 * Xyz — a zona do monstro Xyz. `null` quando não há para onde voar: matéria
 * anexada a um Xyz ainda no Extra Deck (a Invocação-Xyz), ou uma pilha que a
 * mesa não desenha nesta tela.
 */
function destinationElement(field: HTMLElement, leave: LeaveGhostData, me: 0 | 1): HTMLElement | null {
  const { controller, location } = leave.to;
  if (leave.why === "material") {
    return (location & OcgLocation.MZONE) !== 0 ? zoneElement(field, leave.to, me) : null;
  }
  const pile =
    (location & OcgLocation.GRAVE) !== 0
      ? "grave"
      : (location & OcgLocation.REMOVED) !== 0
        ? "banished"
        : (location & OcgLocation.EXTRA) !== 0
          ? "extra"
          : (location & OcgLocation.DECK) !== 0
            ? "deck"
            : null;
  if (pile) return field.querySelector<HTMLElement>(`[data-pile="${pile}-${controller}"]`);
  if ((location & OcgLocation.HAND) !== 0) {
    return field.querySelector<HTMLElement>(`[data-hand="${controller}"]`);
  }
  return null;
}

function boxOf(el: HTMLElement, fieldBox: DOMRect): Box | null {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return { x: r.left - fieldBox.left, y: r.top - fieldBox.top, w: r.width, h: r.height };
}

/**
 * O voo até a pilha: sobe um pouco da zona (a carta "sai" da mesa), atravessa
 * e encolhe até o tamanho da pilha, com o jeito do motivo — escurece indo ao
 * Cemitério, brilho violeta no banimento, limpa voltando à mão ou ao Deck.
 * O `translate` vem antes do giro: o caminho é na tela, e a carta do oponente
 * (de cabeça para baixo) viaja assim, sem se endireitar.
 */
function flightFrames(why: LeaveReason, spin: string, dx: number, dy: number, scale: number): Keyframe[] {
  const fim = `translate(${dx}px, ${dy}px) ${spin} scale(${scale})`;
  const subida = `translate(${dx * 0.04}px, ${dy * 0.04 - 8}px) ${spin} scale(1.06)`;
  const filtros: Record<string, [string, string, string]> = {
    banish: ["brightness(1)", "brightness(1.5) hue-rotate(-40deg) saturate(1.4)", "brightness(1.8) hue-rotate(220deg)"],
    hand: ["brightness(1)", "brightness(1.15)", "brightness(1)"],
    deck: ["brightness(1)", "brightness(1.15)", "brightness(1)"],
  };
  const [a, b, c] = filtros[why] ?? ["brightness(1)", "brightness(1.1)", "brightness(0.55) grayscale(0.5)"];
  return [
    { transform: `translate(0px, 0px) ${spin} scale(1)`, opacity: 1, filter: a, offset: 0 },
    { transform: subida, opacity: 1, filter: b, offset: 0.22, easing: "cubic-bezier(0.5, 0, 0.3, 1)" },
    { transform: fim, opacity: why === "banish" ? 0.15 : 0.85, filter: c, offset: 1 },
  ];
}

/** Quadros de cada saída sem para onde voar: a forma do movimento diz o motivo. */
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
function Estilhaco({
  image,
  duration,
  delay = 0,
  hologram,
}: {
  image: string | null;
  duration: number;
  /** Espera antes de estourar — a carta espera o holograma dela. */
  delay?: number;
  /** As fatias do holograma (a de trás é o monstro inteiro): cacos dele. */
  hologram?: { layers: number };
}) {
  return (
    <span
      className={`md-shatter ${hologram ? "md-shatter-holo" : ""}`}
      style={{ ["--md-shatter-ms" as string]: `${duration}ms` }}
    >
      <span className="md-shatter-flash" style={{ animationDelay: `${delay}ms` }} />
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
              // Holograma: só a fatia de trás da folha de fatias.
              backgroundSize: hologram ? `100% ${hologram.layers * 100}%` : undefined,
              backgroundPosition: hologram ? "0 0" : undefined,
              ["--md-dx" as string]: `${dx}%`,
              ["--md-dy" as string]: `${dy}%`,
              ["--md-rot" as string]: `${giro}deg`,
              animationDelay: `${delay + (index % 4) * 14}ms`,
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
  holo,
}: {
  leave: LeaveGhostData;
  fieldRef: RefObject<HTMLDivElement | null>;
  image: string | null;
  me: 0 | 1;
  holo: { url: string; layers: number; mode: HologramMode } | null;
}) {
  const [geo, setGeo] = useState<{ box: Box; dest: Box | null; holo: Box | null } | null>(null);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const deLa = leave.from.controller !== me;
  // A carta do oponente está de cabeça para baixo na mesa: o fantasma nasce
  // (e viaja) assim.
  const spin = deLa ? "rotate(180deg)" : "";

  // Mede a zona de origem, o destino e — destruição com holograma — onde o
  // holograma estava, uma vez, ao nascer.
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const zone = zoneElement(field, leave.from, me);
    if (!zone) return;
    const fieldBox = field.getBoundingClientRect();
    const zoneBox = zone.getBoundingClientRect();
    // A casa permanece quadrada depois da saída; o fantasma conserva a
    // proporção da carta que estava no centro, sem virar uma imagem quadrada.
    const location = leave.from.location;
    const fieldCard = location === 4 || location === 8;
    const cardWidth = fieldCard ? zoneBox.width * 59 / 86 : zoneBox.width;
    const portrait = {
      left: zoneBox.left + (zoneBox.width - cardWidth) / 2,
      top: zoneBox.top,
      width: cardWidth,
      height: zoneBox.height,
    };
    const box = {
      x: portrait.left - fieldBox.left,
      y: portrait.top - fieldBox.top,
      w: portrait.width,
      h: portrait.height,
    };
    const destino = destinationElement(field, leave, me);
    const dest = destino ? boxOf(destino, fieldBox) : null;

    // O holograma só estoura se estava à vista: no modo "Sempre", sempre; em
    // "Em momentos", se estava de pé quando o monstro saiu (o ataque o
    // levanta) — o elemento já foi embora, vale a anotação dele.
    let holoBox: Box | null = null;
    const zoneKey = cardKey(leave.from.controller, leave.from.location, leave.from.sequence);
    if (holo && (holo.mode === "always" || hologramWasLit(field, zoneKey))) {
      const a = hologramAnchor(portrait, fieldBox, deLa, Boolean(field.closest(".md-narrow")));
      holoBox = { x: a.x - a.side / 2, y: a.y - a.side, w: a.side, h: a.side };
    }
    setGeo({ box, dest, holo: holoBox });
  }, [leave, fieldRef, me, holo, deLa]);

  const estilhaca = leave.why === "battle" || leave.why === "destroy";

  // O voo (ou, sem destino, a saída na própria zona).
  useEffect(() => {
    if (!node || !geo || estilhaca) return;
    const { box, dest } = geo;
    const frames = dest
      ? flightFrames(
          leave.why,
          spin,
          dest.x + dest.w / 2 - (box.x + box.w / 2),
          dest.y + dest.h / 2 - (box.y + box.h / 2),
          // A mão é uma faixa larga: a carta chega do tamanho de uma carta
          // dela (~a altura da faixa), não do tamanho da faixa.
          Math.min(1.1, Math.max(0.35, Math.min(dest.h, dest.w) / box.h)),
        )
      : framesFor(leave.why, spin);
    const animation = node.animate(frames, {
      // O voo acaba um pouco antes da pausa: o pulso da pilha usa o resto.
      duration: dest ? leave.duration * 0.82 : leave.duration,
      easing: dest ? "cubic-bezier(0.45, 0, 0.25, 1)" : "cubic-bezier(0.3, 0, 0.3, 1)",
      fill: "forwards",
    });
    return () => animation.cancel();
  }, [node, geo, leave, estilhaca, spin]);

  if (!geo) return null;
  const { box, dest } = geo;

  if (estilhaca) {
    // A cadeia: o holograma estoura primeiro, a carta logo depois (já acesa,
    // esperando), e o Cemitério acende no fim.
    const T = leave.duration;
    const holoMs = Math.round(T * 0.55);
    const atraso = geo.holo ? Math.round(T * 0.22) : 0;
    const cartaMs = geo.holo ? Math.round(T * 0.62) : Math.round(T * 0.78);
    return (
      <>
        {geo.holo && (
          <div
            data-leave-hologram={leave.why}
            className="pointer-events-none absolute z-30"
            style={{ left: geo.holo.x, top: geo.holo.y, width: geo.holo.w, height: geo.holo.h }}
          >
            <Estilhaco image={holo?.url ?? null} duration={holoMs} hologram={{ layers: holo?.layers ?? 1 }} />
          </div>
        )}
        <div
          data-leave-ghost={leave.why}
          className="pointer-events-none absolute z-30"
          style={{ left: box.x, top: box.y, width: box.w, height: box.h, transform: spin || undefined }}
        >
          <Estilhaco image={image} duration={cartaMs} delay={atraso} />
        </div>
        {dest && <PilePulse box={dest} why={leave.why} delay={atraso + cartaMs * 0.7} duration={T - (atraso + cartaMs * 0.7)} />}
      </>
    );
  }

  return (
    <>
      <div
        ref={setNode}
        data-leave-ghost={leave.why}
        data-leave-to={dest ? "pile" : undefined}
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
      {dest && (
        <PilePulse box={dest} why={leave.why} delay={leave.duration * 0.72} duration={leave.duration * 0.28} />
      )}
    </>
  );
}

/** A pilha acende quando a carta chega — a cor do motivo. */
function PilePulse({ box, why, delay, duration }: { box: Box; why: LeaveReason; delay: number; duration: number }) {
  return (
    <span
      aria-hidden
      data-pile-pulse={why}
      className={`md-pile-pulse md-pile-pulse-${why}`}
      style={{
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        animationDelay: `${Math.round(delay)}ms`,
        animationDuration: `${Math.max(120, Math.round(duration))}ms`,
      }}
    />
  );
}
