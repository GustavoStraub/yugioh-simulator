"use client";

import { useId, useLayoutEffect, useRef, type RefObject } from "react";
import { OcgLocation } from "@n1xx1/ocgcore-wasm";
import { chainZoneKey, isLiveChainLink } from "@/lib/duel/chain-targets";
import type { DuelChainLink, DuelChainTarget } from "@/lib/duel/duel-session";

/** Miras ficam à vista durante a corrente; setas consultam um elo por vez. */
export function ChainTargetsLayer({ links, inspectedLink, fieldRef }: {
  links: DuelChainLink[];
  inspectedLink: number | null;
  fieldRef: RefObject<HTMLDivElement | null>;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const marker = useId();
  const live = links.filter(isLiveChainLink);
  const selected = live.find((link) => link.state === "resolving")
    ?? live.find((link) => link.link === inspectedLink) ?? live.at(-1);
  const targets = new Map<string, { target: DuelChainTarget; links: number[] }>();
  for (const link of live) {
    for (const target of link.targets ?? []) {
      if (!target.present) continue;
      const key = chainZoneKey(target.zone);
      const entry = targets.get(key) ?? { target, links: [] };
      entry.links.push(link.link);
      targets.set(key, entry);
    }
  }

  useLayoutEffect(() => {
    const field = fieldRef.current;
    const svg = svgRef.current;
    if (!field || !svg) return;
    const anchor = (target: DuelChainTarget) => {
      const { location, controller } = target.zone;
      const zone = field.querySelector<HTMLElement>(`[data-zone="${chainZoneKey(target.zone)}"] .md-card-plane`);
      if (zone) return zone;
      const pile = location === OcgLocation.GRAVE ? "grave" : location === OcgLocation.REMOVED ? "banished" : null;
      return pile ? field.querySelector<HTMLElement>(`[data-pile="${pile}-${controller}"]`) : null;
    };
    const positioned = [...targets.entries()].map(([key, entry], index) => ({
      key, entry, element: anchor(entry.target),
      group: svg.querySelector<SVGGElement>(`[data-target-index="${index}"]`),
    }));
    const source = selected ? anchor({ zone: selected.zone, code: selected.code, present: true }) : null;
    let frame = 0;
    const position = () => {
      const base = field.getBoundingClientRect();
      svg.setAttribute("viewBox", `0 0 ${base.width} ${base.height}`);
      const from = source?.getBoundingClientRect();
      for (const { entry, element, group } of positioned) {
        if (!group) continue;
        const box = element?.getBoundingClientRect();
        group.style.display = box?.width && box.height ? "" : "none";
        if (!box?.width || !box.height) continue;
        const x = box.left - base.left - 4;
        const y = box.top - base.top - 4;
        const w = box.width + 8;
        const h = box.height + 8;
        const c = Math.min(13, w * 0.25);
        group.querySelector('[data-target-reticle]')?.setAttribute("d",
          `M ${x} ${y+c} V ${y} H ${x+c} M ${x+w-c} ${y} H ${x+w} V ${y+c} M ${x+w} ${y+h-c} V ${y+h} H ${x+w-c} M ${x+c} ${y+h} H ${x} V ${y+h-c}`);
        const badge = group.querySelector<SVGGElement>('[data-target-badge]');
        badge?.setAttribute("transform", `translate(${x+w/2} ${y-3})`);
        const arrow = group.querySelector<SVGPathElement>('[data-chain-target-arrow]');
        if (!arrow) continue;
        arrow.setAttribute("d", "");
        if (!from?.width || !selected || !entry.links.includes(selected.link) || source === element) continue;
        const dx = box.left + box.width/2 - from.left - from.width/2;
        const dy = box.top + box.height/2 - from.top - from.height/2;
        const edge = (r: DOMRect) => Math.min(Math.abs(dx) ? r.width/2/Math.abs(dx) : Infinity, Math.abs(dy) ? r.height/2/Math.abs(dy) : Infinity, 0.45);
        const start = edge(from), end = edge(box);
        const sx = from.left + from.width/2 - base.left, sy = from.top + from.height/2 - base.top;
        arrow.setAttribute("d", `M ${sx+dx*start} ${sy+dy*start} L ${sx+dx*(1-end)} ${sy+dy*(1-end)}`);
      }
      frame = requestAnimationFrame(position);
    };
    position();
    return () => cancelAnimationFrame(frame);
  });

  if (!targets.size) return null;
  return (
    <svg ref={svgRef} aria-hidden data-chain-targets data-inspected-chain={selected?.link}
      className="pointer-events-none absolute inset-0 z-[14] h-full w-full overflow-visible">
      <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M 1 1 L 9 5 L 1 9 Z" fill="#fcd34d" />
      </marker></defs>
      {[...targets.entries()].map(([key, entry], index) => (
        <g key={key} data-target-index={index} data-chain-target-for={key} data-target-links={entry.links.join(",")}
          data-target-resolving={entry.links.some((n) => live.find((link) => link.link === n)?.state === "resolving") || undefined}>
          <path data-chain-target-arrow fill="none" stroke="#fcd34d" strokeWidth="2" strokeDasharray="5 4" markerEnd={`url(#${marker})`} />
          <path data-target-reticle className="md-chain-target-reticle" fill="none" stroke="#fcd34d" strokeWidth="2.5" />
          <g data-target-badge>
            <rect x={-22} y={-10} width={44} height={14} rx={4} fill="#fcd34d" stroke="#422006" />
            <text textAnchor="middle" fontSize="9" fontWeight="900" fill="#1c1917">ALVO · {entry.links.join(",")}</text>
          </g>
        </g>
      ))}
    </svg>
  );
}
