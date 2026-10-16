"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/*
 * A "lista de cartas" do Master Duel: a faixa horizontal de cartas que toda
 * escolha usa (buscar no Deck, escolher do Cemitério, responder na corrente,
 * consultar uma pilha), com as setas dos lados e a troca para grade.
 */

/**
 * A faixa de cartas. Rola na horizontal (setas nas pontas, roda do mouse); em
 * grade quebra em linhas. A grade é a aba do canto do painel no MD.
 */
export function CardStrip({ grid = false, children }: { grid?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [bordas, setBordas] = useState({ inicio: true, fim: true });

  useEffect(() => {
    const faixa = ref.current;
    if (!faixa) return;
    const medir = () =>
      setBordas({
        inicio: faixa.scrollLeft <= 2,
        fim: faixa.scrollLeft + faixa.clientWidth >= faixa.scrollWidth - 2,
      });
    medir();
    faixa.addEventListener("scroll", medir, { passive: true });
    const observador = new ResizeObserver(medir);
    observador.observe(faixa);
    return () => {
      faixa.removeEventListener("scroll", medir);
      observador.disconnect();
    };
  }, [grid]);

  // A roda do mouse rola a faixa para os lados — é o gesto de quem procura
  // uma carta numa lista comprida.
  useEffect(() => {
    const faixa = ref.current;
    if (!faixa || grid) return;
    const roda = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (faixa.scrollWidth <= faixa.clientWidth) return;
      event.preventDefault();
      faixa.scrollLeft += event.deltaY;
    };
    faixa.addEventListener("wheel", roda, { passive: false });
    return () => faixa.removeEventListener("wheel", roda);
  }, [grid]);

  const rolar = (sentido: 1 | -1) => {
    const faixa = ref.current;
    if (!faixa) return;
    faixa.scrollBy({ left: sentido * faixa.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <div className="md-strip-wrap">
      {!grid && !bordas.inicio && (
        <button type="button" aria-label="Cartas anteriores" className="md-strip-arrow md-strip-arrow-left" onClick={() => rolar(-1)}>
          ‹
        </button>
      )}
      <div ref={ref} className={`md-strip ${grid ? "md-strip-grid" : ""}`}>
        {children}
      </div>
      {!grid && !bordas.fim && (
        <button type="button" aria-label="Próximas cartas" className="md-strip-arrow md-strip-arrow-right" onClick={() => rolar(1)}>
          ›
        </button>
      )}
    </div>
  );
}

/** A aba de grade do canto do painel — alterna faixa/grade. */
export function GridTab({ grid, onToggle }: { grid: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-table-control
      aria-pressed={grid}
      onClick={onToggle}
      title={grid ? "Ver em faixa" : "Ver em grade"}
      aria-label={grid ? "Ver em faixa" : "Ver em grade"}
      className={`md-sheet-tab ${grid ? "md-sheet-tab-on" : ""}`}
    >
      <svg aria-hidden viewBox="0 0 24 24" className="h-[18px] w-[18px]">
        <path d="M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z" fill="none" stroke="currentColor" strokeWidth="2.2" />
      </svg>
    </button>
  );
}

/**
 * Uma carta da lista. A imagem é a carta inteira, como no MD; embaixo, de onde
 * ela vem (na cor do dono: azul sua, vermelho do oponente) e, marcada, o
 * contorno amarelo com o ✓.
 */
export function CardTile({
  image,
  alt,
  faceDown = false,
  place,
  owner = null,
  picked = false,
  actionable = false,
  dimmed = false,
  onClick,
  onHover,
  title,
  data,
  children,
}: {
  image?: string;
  alt: string;
  /** Verso: a carta que este assento ainda não pode ver. */
  faceDown?: boolean;
  /** "Deck", "Cemitério"… — a etiqueta do pé. */
  place?: string;
  owner?: "me" | "foe" | null;
  picked?: boolean;
  /** Tem jogada agora (o brilho amarelo do MD). */
  actionable?: boolean;
  /** Apagada: há outras com jogada e esta não. */
  dimmed?: boolean;
  onClick?: () => void;
  onHover?: () => void;
  title?: string;
  /** Atributos `data-*` (os testes acham as cartas por eles). */
  data?: Record<string, string | number | boolean | undefined>;
  children?: ReactNode;
}) {
  const Tag = onClick || onHover ? "button" : "div";
  return (
    <Tag
      {...(Tag === "button" ? { type: "button" as const } : {})}
      {...data}
      onClick={onClick}
      onClickCapture={() => onHover?.()}
      title={title}
      className={`md-tile ${picked ? "md-tile-picked" : ""} ${actionable ? "md-tile-actionable" : ""} ${
        dimmed ? "md-tile-dim" : ""
      } ${owner ? `md-tile-${owner}` : ""}`}
    >
      <span className="md-tile-card">
        {image && !faceDown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={alt} loading="lazy" draggable={false} className="h-full w-full object-cover" />
        ) : (
          <span className="tf-card-back block h-full w-full" />
        )}
        {picked && <span className="md-tile-check">✓</span>}
      </span>
      {place && <span className="md-tile-place">{place}</span>}
      {children}
    </Tag>
  );
}
