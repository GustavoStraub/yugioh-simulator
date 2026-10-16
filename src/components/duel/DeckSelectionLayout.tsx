"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

import { DuelCardPreview } from "@/components/duel/DuelCardPreview";
import { CardDetailsDialog } from "@/components/layout/CardDetailsDialog";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import type { CardRegistry } from "@/lib/domain/card-registry";

const CardInspectionContext = createContext<((code: number) => void) | undefined>(undefined);
export const useCardInspection = () => useContext(CardInspectionContext);

/** Detalhe da carta à esquerda, seleção ao centro e ações à direita quando fornecidas. */
export function DeckSelectionLayout({
  registry,
  hoveredCode,
  actions,
  children,
}: {
  registry: CardRegistry | null;
  hoveredCode: number | null;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const threeColumns = actions !== undefined;
  const touchReader = useMediaQuery("(max-width: 1023px), (pointer: coarse)");
  const [reading, setReading] = useState<number | null>(null);
  const closeReading = useCallback(() => setReading(null), []);

  return (
    <CardInspectionContext.Provider value={touchReader ? setReading : undefined}>
      <div
        className={`deck-selection mx-auto grid w-full flex-1 grid-cols-1 gap-4 p-4 ${
          threeColumns
            ? "min-h-0 max-w-[1800px] items-stretch lg:grid-cols-3 lg:gap-5 lg:overflow-hidden lg:p-5"
            : "max-w-[1500px] items-start justify-center lg:grid-cols-[minmax(260px,360px)_minmax(0,672px)] lg:gap-6 lg:p-6"
        }`}
      >
        <aside
          className={`md-duel hidden flex-col lg:flex ${
            threeColumns
              ? "h-[min(38vh,360px)] min-h-[260px] lg:h-full lg:min-h-0"
              : "h-[min(38vh,360px)] min-h-[260px] lg:sticky lg:top-[108px] lg:h-[calc(100vh-124px)] lg:min-h-[420px]"
          }`}
        >
          <DuelCardPreview
            card={hoveredCode === null ? null : { code: hoveredCode }}
            registry={registry}
          />
        </aside>
        <div
          className={`mx-auto flex w-full flex-col gap-6 ${
            threeColumns
              ? "min-h-0 max-w-none lg:h-full lg:overflow-y-auto lg:pr-1"
              : "max-w-2xl"
          }`}
        >
          {children}
        </div>
        {threeColumns && (
          <aside className="mx-auto flex w-full min-h-0 max-w-2xl flex-col gap-4 lg:h-full lg:max-w-none lg:overflow-y-auto lg:pr-1">
            <p className="duel-orientation-note rounded-xl border border-sky-900/60 bg-sky-950/30 p-3 text-sm text-sky-200">
              ↻ No telefone, jogue na horizontal para ter mais espaço no campo. Toque numa carta para ler os detalhes ao lado da mesa.
            </p>
            {actions}
          </aside>
        )}
      </div>
      {reading !== null && <CardDetailsDialog code={reading} registry={registry} onClose={closeReading} />}
    </CardInspectionContext.Provider>
  );
}
