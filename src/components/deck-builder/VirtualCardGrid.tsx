"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Grade de cartas que só desenha as fileiras visíveis.
 *
 * Com o pool Goat (1.690 cartas) desenhar tudo era aceitável; com o TCG
 * inteiro (~13.900) a grade virava dezenas de milhares de nós no DOM e cada
 * tecla da busca travava a tela. Aqui a altura total é reservada (a barra de
 * rolagem continua honesta) e só as fileiras na janela — mais uma folga acima
 * e abaixo — existem de fato.
 *
 * As cartas têm proporção fixa (59×86); a largura de cada uma sai da largura
 * disponível, como no `grid auto-fill` que esta grade substitui.
 */
const ASPECT = 86 / 59;
const PADDING = 8;
/** Fileiras desenhadas além das visíveis, para a rolagem não mostrar buraco. */
const FOLGA = 2;

export function VirtualCardGrid<T>({
  items,
  itemKey,
  render,
  minItemWidth = 104,
  gap = 8,
  resetKey,
}: {
  items: readonly T[];
  itemKey: (item: T) => string | number;
  render: (item: T) => ReactNode;
  minItemWidth?: number;
  gap?: number;
  /** Quando muda (outro filtro, outro formato), a rolagem volta ao topo. */
  resetKey?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Busca nova começa do topo: continuar no meio de uma lista que mudou de
  // conteúdo mostraria cartas aleatórias da nova lista. Mexe só no DOM — o
  // evento de rolagem que isso dispara atualiza o estado sozinho.
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [resetKey]);

  const inner = Math.max(0, size.width - PADDING * 2);
  const cols = Math.max(1, Math.floor((inner + gap) / (minItemWidth + gap)));
  const itemWidth = cols > 0 ? (inner - gap * (cols - 1)) / cols : minItemWidth;
  const rowHeight = itemWidth * ASPECT + gap;
  const rows = Math.ceil(items.length / cols);
  const first = rowHeight > 0 ? Math.max(0, Math.floor(scrollTop / rowHeight) - FOLGA) : 0;
  const last =
    rowHeight > 0
      ? Math.min(rows, Math.ceil((scrollTop + size.height) / rowHeight) + FOLGA)
      : Math.min(rows, 6);
  const visible = items.slice(first * cols, last * cols);

  return (
    <div
      ref={ref}
      data-virtual-grid={items.length}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      className="min-h-0 flex-1 overflow-y-auto"
      style={{ padding: PADDING }}
    >
      <div style={{ position: "relative", height: Math.max(0, rows * rowHeight - gap) }}>
        <div
          style={{
            position: "absolute",
            top: first * rowHeight,
            left: 0,
            right: 0,
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gap,
          }}
        >
          {visible.map((item) => (
            <div key={itemKey(item)}>{render(item)}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
