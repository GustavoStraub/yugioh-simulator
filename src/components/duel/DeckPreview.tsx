"use client";

import { useMemo, useState } from "react";

import { useCardText } from "@/hooks/useCardText";
import type { CardRegistry } from "@/lib/domain/card-registry";
import { deckStats, type DeckEntry } from "@/lib/domain/deck-stats";
import type { DuelDeckPayload } from "@/lib/types";

/** Quantas cartas a faixa mostra antes de "ver a lista completa". */
const NA_FAIXA = 10;

/**
 * Prévia de um deck: a contagem por tipo e as cartas que ele mais usa.
 *
 * No lobby contra o bot só havia o nome do deck num `<select>` — escolher o
 * adversário era adivinhar. Aqui aparecem as cartas (as mais repetidas
 * primeiro, como os "três cards principais" que o Master Duel mostra no
 * replay), e a lista inteira a um clique.
 */
export function DeckPreview({
  deck,
  registry,
}: {
  deck: DuelDeckPayload;
  registry: CardRegistry | null;
}) {
  const [aberta, setAberta] = useState(false);
  const stats = useMemo(() => deckStats(deck.main, deck.extra, registry), [deck, registry]);
  const faixa = stats.mainEntries.slice(0, NA_FAIXA);

  return (
    <div data-deck-preview className="mt-4 rounded-lg border border-zinc-800 bg-black/30 p-3">
      <p className="text-[12px] text-zinc-400">
        <span className="font-semibold text-zinc-200">{stats.main} cartas</span> · {stats.monsters}{" "}
        monstros · {stats.spells} magias · {stats.traps} armadilhas
        {stats.extra > 0 ? ` · Extra ${stats.extra}` : ""}
      </p>

      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
        {faixa.map((entry) => (
          <Miniatura key={entry.code} entry={entry} />
        ))}
      </div>

      <button
        type="button"
        onClick={() => setAberta((valor) => !valor)}
        aria-expanded={aberta}
        className="mt-1 text-[12px] text-amber-400 underline-offset-2 hover:underline"
      >
        {aberta ? "Esconder a lista" : "Ver a lista completa"}
      </button>

      {aberta && (
        <div data-deck-preview-list className="mt-2 space-y-2">
          <Lista titulo="Deck principal" entries={stats.mainEntries} />
          {stats.extraEntries.length > 0 && <Lista titulo="Extra Deck" entries={stats.extraEntries} />}
        </div>
      )}
    </div>
  );
}

function Miniatura({ entry }: { entry: DeckEntry }) {
  const texto = useCardText();
  const nome = entry.definition ? texto.name(entry.definition) : `Carta ${entry.code}`;
  const imagem = entry.definition?.images[0]?.image_url_small ?? `/card-images/small/${entry.code}.jpg`;
  return (
    <div title={`${nome} ×${entry.count}`} className="relative w-[52px] shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imagem} alt={nome} loading="lazy" className="aspect-[59/86] w-full rounded-[3px] object-cover" />
      {entry.count > 1 && (
        <span className="absolute bottom-0.5 right-0.5 rounded bg-black/85 px-1 text-[10px] font-bold text-amber-300">
          ×{entry.count}
        </span>
      )}
    </div>
  );
}

function Lista({ titulo, entries }: { titulo: string; entries: DeckEntry[] }) {
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
