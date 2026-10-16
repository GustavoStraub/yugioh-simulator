"use client";

import { useMemo, useState } from "react";

import type { OcgOpCode } from "@n1xx1/ocgcore-wasm";

import { playSfx } from "@/lib/audio/sfx";
import { isTokenCard } from "@/lib/duel/card-adapter";
import { announceCardMatches } from "@/lib/duel/duel-actions";
import type { OfficialCardDb } from "@/lib/duel/official-card-data";
import type { CardDefinition } from "@/lib/types";
import { useCardText } from "@/hooks/useCardText";
import { DecisionShell, PeekButton } from "@/components/duel/DecisionShell";

/**
 * Teto de resultados renderizados por busca. O catálogo do pool Goat passa de
 * mil cartas — listar tudo de uma vez só deixaria a rolagem lenta sem ajudar
 * em nada (ninguém lê mil miniaturas procurando um nome).
 */
const MAX_RESULTS = 60;

/**
 * Busca por nome para declarar uma carta (ANNOUNCE_CARD) — Acordo do
 * Arquidemônio, Designators, Estilhaçar Mentes, Proibição, Questionamento...
 *
 * O core manda um filtro (pilha de opcodes) restringindo quais nomes valem;
 * `announceCardMatches` decide, carta a carta do registry, quem passa nele —
 * com os dados oficiais (`officialDb`), pela mesma conta do core. Fichas nunca
 * são um nome declarável e ficam de fora da busca.
 *
 * Quando o filtro deixa poucos nomes ("declare 1 'Gadget'"), eles aparecem já
 * de saída: digitar para descobrir quais existem seria adivinhação.
 */
export function AnnounceCardModal({
  instruction,
  opcodes,
  cards,
  officialDb,
  onRespond,
  onHover,
  hidden = false,
  onPeek,
}: {
  instruction: string;
  opcodes: readonly OcgOpCode[];
  cards: CardDefinition[];
  /** Banco oficial; `null` enquanto carrega. */
  officialDb: OfficialCardDb | null;
  onRespond: (code: number) => void;
  /**
   * Manda a carta sob o mouse para o painel de leitura da esquerda. Declarar
   * um nome (Proibição, Designators) é decidir pelo TEXTO da carta, e a grade
   * de resultados só mostra arte e nome.
   */
  onHover?: (card: { code: number } | null) => void;
  /** Escondido para ver a mesa — a busca digitada continua aqui. */
  hidden?: boolean;
  onPeek?: () => void;
}) {
  const texto = useCardText();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CardDefinition | null>(null);

  const legal = useMemo(
    () =>
      officialDb
        ? cards.filter(
            (card) =>
              !isTokenCard(card) &&
              announceCardMatches(opcodes, card, officialDb.get(card.passcode)),
          )
        : [],
    [cards, opcodes, officialDb],
  );

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return legal.length <= MAX_RESULTS ? legal : [];
    return legal
      .filter((card) =>
        `${card.name} ${card.nameEn ?? ""}`.toLowerCase().includes(term),
      )
      .slice(0, MAX_RESULTS);
  }, [legal, query]);

  return (
    <DecisionShell
      label={instruction}
      hidden={hidden}
      className="flex max-h-full w-[min(680px,95%)] flex-col overflow-hidden"
    >
        <header className="tf-modal-head shrink-0 px-5 py-2.5">
          <p className="text-center text-base font-semibold text-[color:var(--tf-gold-bright)]">
            {instruction}
          </p>
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(null);
            }}
            placeholder="Digite parte do nome da carta..."
            className="mt-2 w-full rounded border border-[color:var(--tf-slot-border)] bg-black/40 px-3 py-2 text-[13px] text-zinc-100 placeholder:text-zinc-500 focus:border-[color:var(--tf-gold)] focus:outline-none"
          />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!officialDb ? (
            <p className="py-10 text-center text-[13px] text-zinc-500">
              Carregando os dados das cartas...
            </p>
          ) : query.trim() === "" && matches.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-zinc-500">
              {legal.length} nomes podem ser declarados — digite para buscar.
            </p>
          ) : matches.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-zinc-500">
              Nenhuma carta encontrada.
            </p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2.5">
              {matches.map((card) => {
                const image = card.images[0]?.image_url_small;
                const isPicked = selected?.passcode === card.passcode;
                return (
                  <button
                    key={card.passcode}
                    type="button"
                    data-announce-result={card.passcode}
                    onClick={() => {
                      playSfx("click");
                      setSelected(card);
                      onHover?.({ code: card.passcode });
                    }}
                    title={texto.name(card)}
                    className={`relative aspect-[59/86] overflow-hidden rounded border-2 transition ${
                      isPicked
                        ? "border-emerald-400 brightness-110"
                        : "border-[color:var(--tf-slot-border)] hover:border-[color:var(--tf-gold)]"
                    }`}
                  >
                    {image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={image}
                        alt={texto.name(card)}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full items-center justify-center bg-black/60 p-1 text-[9px] text-zinc-300">
                        {texto.name(card)}
                      </span>
                    )}

                    <span className="absolute inset-x-0 bottom-0 truncate bg-black/80 px-1 py-0.5 text-[9px] font-semibold text-[color:var(--tf-gold-bright)]">
                      {texto.name(card)}
                    </span>

                    {isPicked && (
                      <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400 text-[11px] font-bold text-black">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {matches.length === MAX_RESULTS && (
            <p className="mt-2 text-center text-[11px] text-[color:var(--tf-gold-dim)]">
              Mostrando os {MAX_RESULTS} primeiros resultados — refine a busca.
            </p>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[color:var(--tf-slot-border)] px-5 py-3">
          <span className="min-w-0 flex-1 truncate text-[13px] text-[color:var(--tf-gold-dim)]">
            {selected ? selected.name : "Nenhuma carta selecionada"}
          </span>
          {onPeek && <PeekButton onPeek={onPeek} />}
          <button
            type="button"
            disabled={!selected}
            onClick={() => {
              playSfx("click");
              if (selected) onRespond(selected.passcode);
            }}
            className="shrink-0 rounded bg-[color:var(--tf-gold)] px-5 py-2 text-[13px] font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Declarar
          </button>
        </footer>
    </DecisionShell>
  );
}
