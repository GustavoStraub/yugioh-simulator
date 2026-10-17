"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { zoneKey, type EquipmentLink } from "@/lib/duel/equipment-links";

interface Inspection {
  key: string;
  code: number | null;
  mode: "hover" | "touch" | "focus";
}

/** Consulta dos vínculos; não participa dos cliques que fazem jogadas. */
export function EquipmentLinksLayer({ links, fieldRef }: {
  links: EquipmentLink[];
  fieldRef: RefObject<HTMLDivElement | null>;
}) {
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const markerId = useId();

  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const cards = new Map(links.flatMap(({ equipment, target }) =>
      [equipment, target].map((card) => [zoneKey(card), card] as const)));
    const keyAt = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return null;
      const plane = target.closest(".md-card-plane");
      if (!plane || !field.contains(plane)) return null;
      return plane.closest<HTMLElement>("[data-zone]")?.dataset.zone ?? null;
    };
    const inspect = (key: string | null, mode: Inspection["mode"]) => {
      const card = key ? cards.get(key) : null;
      setInspection(card ? { key: key!, code: card.code, mode } : null);
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const key = keyAt(event.target);
      if (key !== keyAt(event.relatedTarget)) inspect(key, "hover");
    };
    const out = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || keyAt(event.target) === keyAt(event.relatedTarget)) return;
      setInspection((current) => current?.mode === "hover" ? null : current);
    };
    const down = (event: PointerEvent) => {
      const key = keyAt(event.target);
      // O vínculo continua visível enquanto se lê a carta no painel/folha.
      if (!key && event.target instanceof Element &&
        event.target.closest("[data-preview-owner], [data-card-sheet], [data-open-card], [data-card-image-dialog]")) return;
      inspect(key, event.pointerType === "mouse" ? "hover" : "touch");
    };
    const focus = (event: FocusEvent) => {
      // O foco provocado pelo toque não deve apagar a consulta ao tirar o dedo.
      setInspection((current) => {
        const key = keyAt(event.target);
        if (current && current.key === key && current.mode !== "focus") return current;
        const card = key ? cards.get(key) : null;
        return card ? { key: key!, code: card.code, mode: "focus" } : null;
      });
    };
    const blur = (event: FocusEvent) => {
      if (keyAt(event.target) !== keyAt(event.relatedTarget)) {
        setInspection((current) => current?.mode === "focus" ? null : current);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInspection(null);
    };
    field.addEventListener("pointerover", over);
    field.addEventListener("pointerout", out);
    field.addEventListener("focusin", focus);
    field.addEventListener("focusout", blur);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", escape);
    return () => {
      field.removeEventListener("pointerover", over);
      field.removeEventListener("pointerout", out);
      field.removeEventListener("focusin", focus);
      field.removeEventListener("focusout", blur);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", escape);
    };
  }, [links, fieldRef]);

  const active = links.filter(({ equipment, target }) =>
    [equipment, target].some((card) => zoneKey(card) === inspection?.key && card.code === inspection.code));

  useLayoutEffect(() => {
    const field = fieldRef.current;
    const svg = svgRef.current;
    if (!field || !svg || !active.length) return;
    const keys = new Set(active.flatMap(({ equipment, target }) => [zoneKey(equipment), zoneKey(target)]));
    const planes = new Map([...keys].flatMap((key) => {
      const plane = field.querySelector<HTMLElement>(`[data-zone="${key}"] .md-card-plane`);
      return plane ? [[key, plane] as const] : [];
    }));
    planes.forEach((plane) => plane.setAttribute("data-equipment-related", ""));
    let frame = 0;
    // As caixas já incluem a câmera 3D. Acompanhar o movimento também cobre
    // chegada das cartas, mudança de posição e rotação do celular.
    const position = () => {
      const base = field.getBoundingClientRect();
      svg.setAttribute("viewBox", `0 0 ${base.width} ${base.height}`);
      active.forEach(({ equipment, target }, index) => {
        const path = svg.querySelector<SVGPathElement>(`[data-equipment-path="${index}"]`);
        const from = planes.get(zoneKey(equipment))?.getBoundingClientRect();
        const to = planes.get(zoneKey(target))?.getBoundingClientRect();
        if (!path || !from || !to) return;
        if (!from.width || !to.width) { path.setAttribute("d", ""); return; }
        const dx = to.left + to.width / 2 - from.left - from.width / 2;
        const dy = to.top + to.height / 2 - from.top - from.height / 2;
        // A seta termina na borda da carta, deixando sua arte livre.
        const edge = (rect: DOMRect) => Math.min(
          Math.abs(dx) > 0 ? rect.width / 2 / Math.abs(dx) : Infinity,
          Math.abs(dy) > 0 ? rect.height / 2 / Math.abs(dy) : Infinity,
          0.45,
        );
        const start = edge(from);
        const end = edge(to);
        const x = from.left + from.width / 2 - base.left;
        const y = from.top + from.height / 2 - base.top;
        path.setAttribute("d", `M ${x + dx * start} ${y + dy * start} L ${x + dx * (1 - end)} ${y + dy * (1 - end)}`);
      });
      frame = requestAnimationFrame(position);
    };
    position();
    return () => {
      cancelAnimationFrame(frame);
      planes.forEach((plane) => plane.removeAttribute("data-equipment-related"));
    };
  }, [active, fieldRef]);

  if (!active.length) return null;
  return (
    <svg ref={svgRef} aria-hidden data-equipment-links
      className="pointer-events-none absolute inset-0 z-[13] h-full w-full overflow-visible">
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 1 1 L 9 5 L 1 9 Z" fill="#6ee7b7" />
        </marker>
      </defs>
      {active.map(({ equipment, target }, index) => (
        <path key={zoneKey(equipment)} data-equipment-path={index}
          data-equipment-from={zoneKey(equipment)} data-equipment-to={zoneKey(target)}
          fill="none" stroke="#6ee7b7" strokeWidth="2.5" strokeLinecap="round"
          markerEnd={`url(#${markerId})`} style={{ filter: "drop-shadow(0 1px 2px #000)" }} />
      ))}
    </svg>
  );
}
