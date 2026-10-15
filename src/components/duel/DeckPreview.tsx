"use client";

import { useMemo, useState } from "react";

import { useCardText } from "@/hooks/useCardText";
import type { CardRegistry } from "@/lib/domain/card-registry";
import { deckStats, type DeckEntry } from "@/lib/domain/deck-stats";
import type { DuelDeckPayload, Passcode } from "@/lib/types";

/** Prévia compacta e somente visual do deck selecionado. */
export function DeckPreview({
  deck,
  registry,
  onCardHover,
}: {
  deck: DuelDeckPayload;
  registry: CardRegistry | null;
  onCardHover?: (code: Passcode) => void;
}) {
  const texto = useCardText();
  const [listaAberta, setListaAberta] = useState(false);
  const stats = useMemo(() => deckStats(deck.main, deck.extra, registry), [deck, registry]);
  const zonas = [
    { label: "Deck principal", cartas: deck.main },
    { label: "Extra Deck", cartas: deck.extra },
    { label: "Side Deck", cartas: deck.side },
  ].filter((zona) => zona.cartas.length > 0);

  return (
    <div data-deck-preview className="mt-4 rounded-lg border border-zinc-800 bg-black/30 p-3">
      <p className="text-[12px] text-zinc-400">
        <span className="font-semibold text-zinc-200">{stats.main} cartas</span> · {stats.monsters}{" "}
        monstros · {stats.spells} magias · {stats.traps} armadilhas
        {stats.extra > 0 ? ` · Extra ${stats.extra}` : ""}
        {deck.side.length > 0 ? ` · Side ${deck.side.length}` : ""}
      </p>

      <div className="mt-2 max-h-48 min-h-0 space-y-2 overflow-y-auto rounded-md border border-zinc-800/70 bg-black/20 p-2">
        {zonas.map((zona) => (
          <section key={zona.label}>
            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              {zona.label} · {zona.cartas.length}
            </h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(65px,1fr))] gap-1">
              {zona.cartas.map((code, index) => {
                const definition = registry?.get(code);
                const nome = definition ? texto.name(definition) : `Carta ${code}`;
                const image =
                  definition?.images[0]?.image_url_small ?? `/card-images/small/${code}.jpg`;
                return (
                  <button
                    key={`${zona.label}-${code}-${index}`}
                    type="button"
                    onMouseEnter={() => onCardHover?.(code)}
                    onFocus={() => onCardHover?.(code)}
                    title={nome}
                    aria-label={nome}
                    className="aspect-[59/86] overflow-hidden rounded-[3px] border border-zinc-800 transition hover:ring-2 hover:ring-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image} alt={nome} loading="lazy" className="h-full w-full object-cover" />
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        {zonas.length === 0 && (
          <p className="py-6 text-center text-xs text-zinc-500">Este deck ainda não tem cartas.</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => setListaAberta((aberta) => !aberta)}
        aria-expanded={listaAberta}
        className="mt-2 text-[12px] text-amber-400 underline-offset-2 hover:underline"
      >
        {listaAberta ? "Esconder a lista" : "Ver a lista completa"}
      </button>

      {listaAberta && (
        <div data-deck-preview-list className="mt-2 space-y-2">
          <Lista titulo="Deck principal" entries={stats.mainEntries} />
          {stats.extraEntries.length > 0 && <Lista titulo="Extra Deck" entries={stats.extraEntries} />}
          {deck.side.length > 0 && (
            <Lista
              titulo="Side Deck"
              entries={deckStats(deck.side, [], registry).mainEntries}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Lista({
  titulo,
  entries,
}: {
  titulo: string;
  entries: DeckEntry[];
}) {
  const texto = useCardText();
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{titulo}</p>
      <ul className="mt-1 grid grid-cols-1 gap-x-4 text-[12px] text-zinc-300 sm:grid-cols-2">
        {entries.map((entry) => (
          <li key={entry.code} className="truncate">
            <span className="font-mono text-amber-300">{entry.count}×</span>{" "}
            {entry.definition ? texto.name(entry.definition) : `Carta ${entry.code}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
