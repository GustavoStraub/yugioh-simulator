"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { playSfx } from "@/lib/audio/sfx";

function subscribe(notify: () => void) {
  document.addEventListener("fullscreenchange", notify);
  const standalone = window.matchMedia("(display-mode: standalone)");
  standalone.addEventListener("change", notify);
  return () => {
    document.removeEventListener("fullscreenchange", notify);
    standalone.removeEventListener("change", notify);
  };
}

function snapshot() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return `${Boolean(document.fullscreenEnabled)}:${Boolean(document.fullscreenElement)}:${standalone}`;
}

function useScreenState() {
  const state = useSyncExternalStore(subscribe, snapshot, () => "false:false:false");
  const [supported, fullscreen, standalone] = state.split(":").map((value) => value === "true");
  return { supported, fullscreen, standalone };
}

/** Atalho da mesa: o documento inteiro inclui também os menus em portal. */
export function DuelFullscreenButton() {
  const { supported, fullscreen, standalone } = useScreenState();
  const [notice, setNotice] = useState<"help" | "error" | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const help = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!notice) return;
    function dismiss(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setNotice(null);
      } else if (!root.current?.contains(event.target as Node) && !help.current?.contains(event.target as Node)) setNotice(null);
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [notice]);

  async function toggle() {
    playSfx("click");
    if (!supported) {
      setNotice((current) => current ? null : "help");
      return;
    }
    setNotice(null);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    } catch {
      setNotice("error");
    }
  }

  if (standalone && !fullscreen) return null;

  const label = fullscreen ? "Sair da tela cheia" : "Entrar em tela cheia";
  return (
    <div ref={root} className="relative" data-table-control>
      <button
        type="button"
        data-fullscreen-toggle
        data-fullscreen-supported={supported}
        onClick={toggle}
        aria-label={label}
        title={label}
        aria-pressed={fullscreen}
        aria-expanded={notice !== null}
        className={`md-round ${fullscreen ? "md-round-on" : ""}`}
      >
        <svg aria-hidden viewBox="0 0 24 24" className="md-round-glyph">
          <path d={fullscreen ? "M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" : "M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6"} />
        </svg>
      </button>
      {notice && createPortal(
        <div ref={help} data-fullscreen-help data-table-control role="dialog" aria-label="Tela cheia" className="md-fullscreen-help">
          <header className="mb-2 flex items-center justify-between gap-2">
            <strong>Tela cheia</strong>
            <button type="button" onClick={() => setNotice(null)} aria-label="Fechar ajuda de tela cheia" className="md-info-close">✕</button>
          </header>
          <p role="status" className="mb-2 text-xs text-amber-200">
            {notice === "error" ? "O navegador não permitiu a tela cheia." : "Neste navegador, abra o jogo pela tela inicial para usar sem a barra de endereço."}
          </p>
          <DuelScreenHelp expanded />
        </div>,
        document.body,
      )}
    </div>
  );
}

export function DuelScreenHelp({ expanded = false }: { expanded?: boolean }) {
  const { fullscreen, standalone } = useScreenState();
  return (
    <div className="space-y-2">
      {standalone && !fullscreen ? (
        <p className="text-xs text-sky-200">O jogo já está aberto como aplicativo.</p>
      ) : (
        <details open={expanded || undefined} data-home-screen-help className="text-xs leading-relaxed text-zinc-300">
          <summary className="flex min-h-11 cursor-pointer items-center text-sky-200">Abrir sem a barra de endereço</summary>
          <p>No iPhone ou iPad, use Compartilhar → Adicionar à Tela de Início. No Android, abra o menu do navegador → Adicionar à tela inicial ou Instalar aplicativo.</p>
          <p className="mt-2 text-zinc-400">Depois, abra o jogo pelo ícone. A barra do sistema depende do aparelho.</p>
        </details>
      )}
    </div>
  );
}
