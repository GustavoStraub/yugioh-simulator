"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { PRESET_DECKS } from "@/lib/data/preset-decks-catalog";
import { getGuideForPreset } from "@/lib/data/deck-guide-index";
import {
  PRESET_KIND_ORDER,
  kindGroupLabel,
  normalizeSearch,
  presetCardCount,
  presetSearchText,
} from "@/lib/domain/preset-decks";
import type { PresetDeckDefinition, PresetDeckKind } from "@/lib/domain/preset-decks";
import { formatOf, type DuelFormat } from "@/lib/types";

interface PresetDeckPickerProps {
  onSelect: (preset: PresetDeckDefinition) => void;
  /** Só os decks deste formato — carregar um deck Goat num deck TCG misturaria pools. */
  format: DuelFormat;
}

type KindFilter = "all" | PresetDeckKind;

/**
 * Seletor dos decks oficiais.
 *
 * No Goat eram 10 decks e uma lista plana bastava; no TCG são ~100, e achar
 * "o Structure Deck dos Fire Kings" rolando cem linhas não funciona. Por isso:
 * busca (nome em PT ou EN, produto, set code, ano — sem acento), filtro por
 * linha de produto, e a lista agrupada por linha, em ordem de lançamento.
 */
export function PresetDeckPicker({ onSelect, format }: PresetDeckPickerProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<PresetDeckDefinition | null>(null);
  const pendingGuide = pending ? getGuideForPreset(pending.id) : undefined;

  const doFormato = useMemo(
    () => PRESET_DECKS.filter((preset) => formatOf(preset.format) === format),
    [format],
  );
  // As linhas que o formato tem — o Goat só tem Iniciais e Estruturais.
  const kinds = useMemo(
    () => PRESET_KIND_ORDER.filter((kind) => doFormato.some((preset) => preset.kind === kind)),
    [doFormato],
  );

  const grupos = useMemo(() => {
    const termos = normalizeSearch(query).split(/\s+/).filter(Boolean);
    const visiveis = doFormato.filter((preset) => {
      if (filter !== "all" && preset.kind !== filter) return false;
      const texto = presetSearchText(preset);
      return termos.every((termo) => texto.includes(termo));
    });
    return kinds
      .map((kind) => ({
        kind,
        decks: visiveis
          .filter((preset) => preset.kind === kind)
          .sort((a, b) => a.year.localeCompare(b.year) || a.namePt.localeCompare(b.namePt)),
      }))
      .filter((grupo) => grupo.decks.length > 0);
  }, [doFormato, filter, kinds, query]);

  const total = grupos.reduce((n, grupo) => n + grupo.decks.length, 0);

  function close() {
    setOpen(false);
    setPending(null);
  }

  function handleConfirm() {
    if (!pending) return;
    onSelect(pending);
    close();
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
            data-preset-picker={format}
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
                    {format === "goat"
                      ? "Produtos Konami lançados até a era Goat"
                      : `${doFormato.length} produtos Konami do TCG, de 2002 até hoje`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800"
                  aria-label="Fechar"
                >
                  ✕
                </button>
              </div>

              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar: nome, set code (SDWD), ano…"
                aria-label="Buscar deck oficial"
                data-preset-search
                className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-amber-600"
              />

              {kinds.length > 1 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {([["all", "Todos"]] as [KindFilter, string][])
                    .concat(kinds.map((kind) => [kind, kindGroupLabel(kind)]))
                    .map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setFilter(value)}
                        data-preset-kind={value}
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
              )}
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-2" data-preset-count={total}>
              {total === 0 && (
                <p className="px-2 py-6 text-center text-sm text-zinc-500">
                  Nenhum deck oficial com “{query}”.
                </p>
              )}
              {grupos.map((grupo) => (
                <section key={grupo.kind} data-preset-group={grupo.kind}>
                  <h3 className="sticky top-0 z-10 bg-zinc-950/95 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-amber-500/80">
                    {kindGroupLabel(grupo.kind)} · {grupo.decks.length}
                  </h3>
                  <ul>
                    {grupo.decks.map((preset) => {
                      const selected = pending?.id === preset.id;
                      return (
                        <li key={preset.id}>
                          <button
                            type="button"
                            onClick={() => setPending(preset)}
                            data-preset-id={preset.id}
                            className={`mb-1 w-full rounded-xl border px-3 py-2.5 text-left transition ${
                              selected
                                ? "border-amber-600 bg-amber-950/40"
                                : "border-transparent bg-zinc-900/60 hover:border-zinc-700"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-zinc-100">
                                  {preset.namePt}
                                </p>
                                {preset.name !== preset.namePt && (
                                  <p className="truncate text-[11px] text-zinc-500">
                                    {preset.name}
                                  </p>
                                )}
                                <p className="mt-0.5 text-[11px] text-zinc-500">
                                  {preset.setCode ? `${preset.setCode} · ` : ""}
                                  {preset.year} · {presetCardCount(preset)} cartas
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
                </section>
              ))}
            </div>

            <footer className="space-y-2 border-t border-zinc-800 p-4">
              {pendingGuide && (
                <Link href={`/aprender/${pendingGuide.id}`} className="block rounded-lg border border-amber-800/60 px-3 py-2 text-center text-xs text-amber-300 hover:bg-amber-950/40">
                  Aprender este deck →
                </Link>
              )}
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
              {format === "tcg" && (
                // As listas (quantidade de cada carta, deck de cada caixa)
                // vêm da Yugipedia, sob CC BY-SA 4.0 — a atribuição é a
                // condição da licença.
                <p className="text-center text-[10px] text-zinc-600">
                  Listas dos produtos:{" "}
                  <a
                    href={pending?.sourceUrl ?? "https://yugipedia.com/"}
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-zinc-400"
                  >
                    Yugipedia
                  </a>{" "}
                  (
                  <a
                    href="https://creativecommons.org/licenses/by-sa/4.0/"
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-zinc-400"
                  >
                    CC BY-SA 4.0
                  </a>
                  )
                </p>
              )}
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
