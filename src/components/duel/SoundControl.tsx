"use client";

import { useState } from "react";

import { getSfxSettings, playSfx, setSfxSettings } from "@/lib/audio/sfx";

/**
 * Controle de volume dos efeitos sonoros.
 *
 * O estado inicial é lido de forma preguiçosa porque `getSfxSettings` toca em
 * `localStorage`, que não existe na renderização do servidor.
 */
export function SoundControl() {
  const [settings, setLocal] = useState(() => getSfxSettings());
  const [open, setOpen] = useState(false);

  function apply(next: { volume?: number; muted?: boolean }) {
    setLocal(setSfxSettings(next));
  }

  const icon = settings.muted || settings.volume === 0 ? "🔇" : "🔊";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Ajustar som"
        title="Som"
        className="tf-panel rounded-md px-2.5 py-1.5 text-base leading-none transition hover:brightness-125"
      >
        {icon}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="tf-panel absolute right-0 top-full z-50 mt-1 w-56 rounded-md p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--tf-gold)]">
                Efeitos sonoros
              </span>
              <button
                type="button"
                onClick={() => apply({ muted: !settings.muted })}
                className={`rounded px-2 py-0.5 text-[11px] font-semibold transition ${
                  settings.muted
                    ? "bg-red-900/70 text-red-200"
                    : "bg-[color:var(--tf-gold)] text-black"
                }`}
              >
                {settings.muted ? "Mudo" : "Ligado"}
              </button>
            </div>

            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(settings.volume * 100)}
              disabled={settings.muted}
              onChange={(event) =>
                apply({ volume: Number(event.target.value) / 100 })
              }
              // Um som de amostra ao soltar dá a referência do nível escolhido.
              onMouseUp={() => playSfx("click")}
              onKeyUp={() => playSfx("click")}
              className="w-full accent-[color:var(--tf-gold)] disabled:opacity-40"
              aria-label="Volume"
            />

            <p className="mt-1 text-right font-mono text-[11px] text-[color:var(--tf-gold-dim)]">
              {settings.muted ? "—" : `${Math.round(settings.volume * 100)}%`}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
