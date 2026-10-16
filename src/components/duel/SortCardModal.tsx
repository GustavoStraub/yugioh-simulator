"use client";

import { useState } from "react";

import { playSfx } from "@/lib/audio/sfx";
import type { SortingMode } from "@/lib/duel/duel-actions";
import { useCardText } from "@/hooks/useCardText";
import type { CardRegistry } from "@/lib/domain/card-registry";
import { DecisionShell, PeekButton } from "@/components/duel/DecisionShell";

/**
 * Ordenação de cartas — "veja as N do topo do Deck e recoloque na ordem que
 * quiser" (Avanço de Carta, Grande Olho e afins).
 *
 * As cartas já chegam enfileiradas na ordem em que estão no Deck (a 1ª é o
 * topo) e o jogador só MEXE no que quer mudar: arrasta uma carta para outra
 * posição, ou usa as setas ◀ ▶ de cada carta (toque e teclado — o arrastar
 * do HTML não funciona no celular). A versão anterior pedia clicar nas N
 * cartas, uma a uma, na ordem desejada, e só liberava o "Confirmar" depois da
 * última — para trocar duas cartas de lugar era preciso numerar todas.
 *
 * A resposta é, para cada posição, o **índice original** da carta que ficou
 * ali (`sorting.build` converte para o formato do core).
 */
export function SortCardModal({
  instruction,
  sorting,
  registry,
  onRespond,
  keepLabel,
  onKeep,
  onHover,
  hidden = false,
  onPeek,
}: {
  instruction: string;
  sorting: SortingMode;
  registry: CardRegistry | null;
  onRespond: (order: number[]) => void;
  keepLabel: string;
  onKeep: () => void;
  /**
   * Manda a carta sob o mouse para o painel de leitura da esquerda — o modal
   * cobre só a coluna do campo, então o trilho continua à vista. A miniatura
   * de 110px dá para reconhecer a arte e não dá para ler o efeito, que é
   * justamente o que decide a ordem.
   */
  onHover?: (card: { code: number } | null) => void;
  /** Escondido para ver a mesa — a ordem já montada continua aqui. */
  hidden?: boolean;
  onPeek?: () => void;
}) {
  const texto = useCardText();
  const total = sorting.cards.length;
  const original = Array.from({ length: total }, (_, index) => index);
  /** Índices originais, na ordem atual da fileira (posição 0 = topo). */
  const [order, setOrder] = useState<number[]>(original);
  /** Posição que está sendo arrastada, e a posição sob o cursor. */
  const [arrastando, setArrastando] = useState<number | null>(null);
  const [sobre, setSobre] = useState<number | null>(null);

  const mexeu = order.some((card, position) => card !== position);

  /** Tira a carta da posição `de` e a coloca na posição `para`. */
  function mover(de: number, para: number) {
    if (de === para || para < 0 || para >= total) return;
    playSfx("click");
    setOrder((atual) => {
      const nova = [...atual];
      const [carta] = nova.splice(de, 1);
      nova.splice(para, 0, carta);
      return nova;
    });
  }

  function soltar() {
    if (arrastando !== null && sobre !== null) mover(arrastando, sobre);
    setArrastando(null);
    setSobre(null);
  }

  return (
    <DecisionShell
      label={instruction}
      hidden={hidden}
      className="flex max-h-full w-[min(820px,95%)] flex-col overflow-hidden"
    >
        <header className="tf-modal-head shrink-0 px-5 py-2.5 text-center">
          <p className="text-base font-semibold text-[color:var(--tf-gold-bright)]">
            {instruction}
          </p>
          <p className="mt-0.5 text-[11px] text-[color:var(--tf-gold-dim)]">
            Arraste as cartas (ou use ◀ ▶) para mudar a ordem. A da esquerda é o
            topo — a próxima a ser comprada.
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-1.5 flex justify-between px-1 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--tf-gold-dim)]">
            <span>⬆ Topo do Deck</span>
            <span>Mais abaixo</span>
          </div>
          <div className="flex flex-wrap justify-center gap-3" data-sort-row>
            {order.map((index, position) => {
              const card = sorting.cards[index];
              const definition = registry?.get(card.code);
              const image = definition?.images[0]?.image_url_small;
              const alvo = sobre === position && arrastando !== null && arrastando !== position;

              return (
                <div
                  key={`${card.code}-${index}`}
                  data-sort-card={index}
                  data-sort-position={position}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    // Firefox só inicia o arrasto com algum dado no transfer.
                    event.dataTransfer.setData("text/plain", String(position));
                    setArrastando(position);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    if (sobre !== position) setSobre(position);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    soltar();
                  }}
                  onDragEnd={() => {
                    setArrastando(null);
                    setSobre(null);
                  }}
                  role="button"
                  tabIndex={0}
                  onClick={() => onHover?.({ code: card.code })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onHover?.({ code: card.code });
                    }
                  }}
                  title={definition ? texto.name(definition) : undefined}
                  className={`relative w-[110px] shrink-0 cursor-grab select-none overflow-hidden rounded border-2 transition active:cursor-grabbing ${
                    arrastando === position
                      ? "border-[color:var(--tf-gold)] opacity-40"
                      : alvo
                        ? "border-[color:var(--tf-gold-bright)] brightness-125"
                        : "border-[color:var(--tf-slot-border)] hover:border-[color:var(--tf-gold)]"
                  }`}
                >
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={image}
                      alt={definition ? texto.name(definition) : "Carta"}
                      draggable={false}
                      className="pointer-events-none aspect-[59/86] w-full object-cover"
                    />
                  ) : (
                    <div className="tf-card-back aspect-[59/86] w-full" />
                  )}

                  <span className="absolute left-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-[color:var(--tf-gold)] font-mono text-sm font-black text-black shadow">
                    {position + 1}
                  </span>

                  <span className="block truncate bg-black/80 px-1 py-0.5 text-[10px] text-zinc-200">
                    {definition ? texto.name(definition) : card.code}
                  </span>

                  <div className="flex border-t border-[color:var(--tf-slot-border)] bg-black/70">
                    <button
                      type="button"
                      aria-label="Mover para cima no Deck"
                      disabled={position === 0}
                      onClick={() => mover(position, position - 1)}
                      className="flex-1 py-1 text-[12px] text-[color:var(--tf-gold-bright)] hover:bg-black disabled:opacity-25"
                    >
                      ◀
                    </button>
                    <button
                      type="button"
                      aria-label="Mover para baixo no Deck"
                      disabled={position === total - 1}
                      onClick={() => mover(position, position + 1)}
                      className="flex-1 border-l border-[color:var(--tf-slot-border)] py-1 text-[12px] text-[color:var(--tf-gold-bright)] hover:bg-black disabled:opacity-25"
                    >
                      ▶
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[color:var(--tf-slot-border)] px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[13px] text-[color:var(--tf-gold-dim)]">
              {total} carta{total === 1 ? "" : "s"}
            </span>
            {onPeek && <PeekButton onPeek={onPeek} />}
          </div>
          <div className="flex gap-2">
            {mexeu && (
              <button
                type="button"
                onClick={() => setOrder(original)}
                className="rounded border border-[color:var(--tf-slot-border)] px-4 py-2 text-[13px] text-zinc-300 hover:bg-black/50"
              >
                Desfazer
              </button>
            )}
            {!mexeu && (
              <button
                type="button"
                onClick={onKeep}
                className="rounded border border-[color:var(--tf-slot-border)] px-4 py-2 text-[13px] text-[color:var(--tf-gold-bright)] hover:bg-black/50"
              >
                {keepLabel}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                playSfx("click");
                onRespond(order);
              }}
              className="rounded bg-[color:var(--tf-gold)] px-5 py-2 text-[13px] font-bold text-black transition hover:brightness-110"
            >
              Confirmar ordem
            </button>
          </div>
        </footer>
    </DecisionShell>
  );
}
