"use client";

import { useState } from "react";

import { playSfx } from "@/lib/audio/sfx";
import type { SortingMode } from "@/lib/duel/duel-actions";
import { useCardText } from "@/hooks/useCardText";
import type { CardRegistry } from "@/lib/domain/card-registry";

/**
 * Ordenação de cartas — "veja as N do topo do Deck e recoloque na ordem que
 * quiser" (Grande Olho, Jarro da Metamorfose e afins).
 *
 * O jogador clica nas cartas na ordem desejada; a resposta enviada ao core é,
 * para cada posição, o **índice original** da carta escolhida. A 1ª escolhida
 * fica no topo do Deck (a próxima a ser comprada).
 */
export function SortCardModal({
  instruction,
  sorting,
  registry,
  onRespond,
  keepLabel,
  onKeep,
  onHover,
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
}) {
  const texto = useCardText();
  /** Índices originais, na ordem escolhida pelo jogador. */
  const [order, setOrder] = useState<number[]>([]);

  const total = sorting.cards.length;
  const completo = order.length === total;

  function alternar(index: number) {
    playSfx("click");
    setOrder((atual) =>
      atual.includes(index)
        ? atual.filter((i) => i !== index)
        : [...atual, index],
    );
  }

  return (
    <div className="tf-modal-scrim tf-modal-area z-50 flex items-center justify-center p-6">
      <div className="tf-modal tf-anim-modal-in flex max-h-full w-[min(820px,95%)] flex-col overflow-hidden">
        <header className="tf-modal-head shrink-0 px-5 py-2.5 text-center">
          <p className="text-base font-semibold text-[color:var(--tf-gold-bright)]">
            {instruction}
          </p>
          <p className="mt-0.5 text-[11px] text-[color:var(--tf-gold-dim)]">
            Clique nas cartas na ordem desejada. A 1ª será a próxima comprada.
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="flex flex-wrap justify-center gap-3">
            {sorting.cards.map((card, index) => {
              const definition = registry?.get(card.code);
              const image = definition?.images[0]?.image_url_small;
              const posicao = order.indexOf(index);
              const escolhida = posicao >= 0;

              return (
                <button
                  key={`${card.code}-${index}`}
                  type="button"
                  onClick={() => alternar(index)}
                  onMouseEnter={() => onHover?.({ code: card.code })}
                  onMouseLeave={() => onHover?.(null)}
                  title={definition ? texto.name(definition) : undefined}
                  className={`relative w-[110px] shrink-0 overflow-hidden rounded border-2 transition ${
                    escolhida
                      ? "border-[color:var(--tf-gold)] brightness-110"
                      : "border-[color:var(--tf-slot-border)] opacity-70 hover:opacity-100"
                  }`}
                >
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={image}
                      alt={definition ? texto.name(definition) : "Carta"}
                      className="aspect-[59/86] w-full object-cover"
                    />
                  ) : (
                    <div className="tf-card-back aspect-[59/86] w-full" />
                  )}

                  {escolhida && (
                    <span className="absolute left-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-[color:var(--tf-gold)] font-mono text-sm font-black text-black shadow">
                      {posicao + 1}
                    </span>
                  )}

                  <span className="block truncate bg-black/80 px-1 py-0.5 text-[10px] text-zinc-200">
                    {definition ? texto.name(definition) : card.code}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[color:var(--tf-slot-border)] px-5 py-3">
          <span className="font-mono text-[13px] text-[color:var(--tf-gold-dim)]">
            {order.length}/{total} ordenadas
          </span>
          <div className="flex gap-2">
            {order.length > 0 && (
              <button
                type="button"
                onClick={() => setOrder([])}
                className="rounded border border-[color:var(--tf-slot-border)] px-4 py-2 text-[13px] text-zinc-300 hover:bg-black/50"
              >
                Limpar
              </button>
            )}
            <button
              type="button"
              onClick={onKeep}
              className="rounded border border-[color:var(--tf-slot-border)] px-4 py-2 text-[13px] text-[color:var(--tf-gold-bright)] hover:bg-black/50"
            >
              {keepLabel}
            </button>
            <button
              type="button"
              disabled={!completo}
              onClick={() => onRespond(order)}
              className="rounded bg-[color:var(--tf-gold)] px-5 py-2 text-[13px] font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Confirmar ordem
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
