"use client";

import type { ReactNode } from "react";

import { DuelCardPreview } from "@/components/duel/DuelCardPreview";
import type { CardRegistry } from "@/lib/domain/card-registry";

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

  return (
    <div
      className={`mx-auto grid w-full flex-1 grid-cols-1 gap-4 p-4 ${
        threeColumns
          ? "min-h-0 max-w-[1800px] items-stretch lg:grid-cols-3 lg:gap-5 lg:overflow-hidden lg:p-5"
          : "max-w-[1500px] items-start justify-center lg:grid-cols-[minmax(260px,360px)_minmax(0,672px)] lg:gap-6 lg:p-6"
      }`}
    >
      <aside
        className={`md-duel flex flex-col ${
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
          {actions}
        </aside>
      )}
    </div>
  );
}
