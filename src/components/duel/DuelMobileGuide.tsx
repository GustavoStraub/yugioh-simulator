"use client";

import { useState } from "react";

export function DuelMobileGuide() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div data-orientation-hint role="status" className="duel-mobile-guide relative z-20 shrink-0">
      <span aria-hidden className="text-2xl">↻</span>
      <p><strong>Mais espaço na horizontal</strong><br />Gire o telefone para ler as cartas com um toque na lateral.</p>
      <button type="button" data-table-control onClick={() => setDismissed(true)} aria-label="Dispensar dica de orientação">✕</button>
    </div>
  );
}
