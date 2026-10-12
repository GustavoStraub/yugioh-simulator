"use client";

import { useMemo, useState } from "react";

import {
  PRESET_DECKS,
  getPresetsByKind,
} from "@/lib/data/preset-decks-catalog";
import { kindLabel, presetCardCount } from "@/lib/domain/preset-decks";
import type { PresetDeckDefinition } from "@/lib/domain/preset-decks";
import { formatOf, type DuelFormat } from "@/lib/types";

interface PresetDeckPickerProps {
  onSelect: (preset: PresetDeckDefinition) => void;
  /** Só os decks deste formato — carregar um deck Goat num deck TCG misturaria pools. */
  format: DuelFormat;
}

type KindFilter = "all" | PresetDeckDefinition["kind"];

export function PresetDeckPicker({ onSelect, format }: PresetDeckPickerProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<KindFilter>("all");
  const [pending, setPending] = useState<PresetDeckDefinition | null>(null);

  const filtered = useMemo(() => {
    const doFormato = (filter === "all" ? PRESET_DECKS : getPresetsByKind(filter)).filter(
      (preset) => formatOf(preset.format) === format,
    );
    return doFormato;
  }, [filter, format]);

  function handleConfirm() {
    if (!pending) return;
    onSelect(pending);
    setPending(null);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border border-amber-700/50 bg-amber-950/30 px-3 py-2.5 text-sm font-medium text-amber-200 transition hover:border-amber-600 hover:bg-amber-950/50"
      >
        Carregar deck oficial
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center">
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-amber-900/40 bg-zinc-950 shadow-2xl"
            role="dialog"
            aria-labelledby="preset-decks-title"
          >
            <header className="border-b border-zinc-800 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2
                    id="preset-decks-title"
                    className="text-base font-semibold text-zinc-100"
                  >
                    Decks oficiais
                  </h2>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Produtos Konami lançados até a era Goat
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setPending(null);
                  }}
                  className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800"
                  aria-label="Fechar"
                >
                  ✕
                </button>
              </div>

              <div className="mt-3 flex gap-2">
                {(
                  [
                    ["all", "Todos"],
                    ["starter", "Iniciais"],
                    ["structure", "Estrutura"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value)}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      filter === value
                        ? "bg-amber-600 text-black"
                        : "bg-zinc-800 text-zinc-300"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </header>

            <ul className="min-h-0 flex-1 overflow-y-auto p-2">
              {filtered.map((preset) => {
                const selected = pending?.id === preset.id;
                return (
                  <li key={preset.id}>
                    <button
                      type="button"
                      onClick={() => setPending(preset)}
                      className={`mb-1 w-full rounded-xl border px-3 py-3 text-left transition ${
                        selected
                          ? "border-amber-600 bg-amber-950/40"
                          : "border-transparent bg-zinc-900/60 hover:border-zinc-700"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-zinc-100">
                            {preset.namePt}
                          </p>
                          <p className="mt-0.5 text-[11px] text-zinc-500">
                            {kindLabel(preset.kind)} · {preset.year} ·{" "}
                            {presetCardCount(preset)} cartas
                            {preset.extra.length > 0 &&
                              ` · ${preset.extra.length} Extra`}
                          </p>
                        </div>
                        {selected && (
                          <span className="text-xs text-amber-400">✓</span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>

            <footer className="space-y-2 border-t border-zinc-800 p-4">
              {pending && (
                <p className="text-center text-xs text-amber-200/80">
                  Substituir o deck atual por{" "}
                  <strong>{pending.namePt}</strong>?
                </p>
              )}
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!pending}
                className="w-full rounded-xl bg-amber-600 py-2.5 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
              >
                Carregar deck
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
