"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { DuelCardPreview } from "@/components/duel/DuelCardPreview";
import type { CardRegistry } from "@/lib/domain/card-registry";

/** Leitura por toque, compartilhada pelo construtor e pelos lobbies. */
export function CardDetailsDialog({
  code,
  registry,
  onClose,
  actions,
}: {
  code: number;
  registry: CardRegistry | null;
  onClose: () => void;
  actions?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        onClose();
      }
      if (event.key !== "Tab") return;
      const items = [...(ref.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]',
      ) ?? [])];
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey, true);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [onClose]);

  return createPortal(
    <div className="md-duel card-reader-scrim" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Detalhes da carta"
        data-card-reader
        tabIndex={-1}
        className="card-reader"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="card-reader-head">
          <span>Detalhes da carta</span>
          <button type="button" onClick={onClose} aria-label="Fechar detalhes da carta" className="md-pill md-pill-ghost px-4">
            Fechar ✕
          </button>
        </header>
        <DuelCardPreview card={{ code }} registry={registry} />
        {actions && <footer className="card-reader-actions">{actions}</footer>}
      </div>
    </div>,
    document.body,
  );
}
