"use client";

import type { ReactNode } from "react";

import { DuelCardPreview } from "@/components/duel/DuelCardPreview";
import type { CardRegistry } from "@/lib/domain/card-registry";

/** Layout dos lobbies: leitura grande à esquerda e controles no centro. */
export function DeckSelectionLayout({
  registry,
  hoveredCode,
  children,
}: {
  registry: CardRegistry | null;
  hoveredCode: number | null;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto grid w-full max-w-[1500px] flex-1 grid-cols-1 items-start justify-center gap-4 p-4 lg:grid-cols-[minmax(260px,360px)_minmax(0,672px)] lg:gap-6 lg:p-6">
      <aside className="md-duel flex h-[min(38vh,360px)] min-h-[260px] flex-col lg:sticky lg:top-[108px] lg:h-[calc(100vh-124px)] lg:min-h-[420px]">
        <DuelCardPreview
          card={hoveredCode === null ? null : { code: hoveredCode }}
          registry={registry}
        />
      </aside>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">{children}</div>
    </div>
  );
}
