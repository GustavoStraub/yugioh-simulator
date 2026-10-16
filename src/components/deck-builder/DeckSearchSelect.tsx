"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { normalizeSearch } from "@/lib/domain/preset-decks";

interface DeckOption {
  value: string;
  label: string;
}

interface DeckOptionGroup {
  label: string;
  opcoes: DeckOption[];
}

/** Dropdown de decks com busca interna, compartilhado pelo construtor e pelos lobbies. */
export function DeckSearchSelect({
  value,
  onChange,
  grupos,
  label,
  disabled = false,
  className,
  controlClassName = "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-600 disabled:opacity-50",
}: {
  value: string;
  onChange: (value: string) => void;
  grupos: DeckOptionGroup[];
  label: string;
  disabled?: boolean;
  className?: string;
  controlClassName?: string;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({});
  const busca = normalizeSearch(query).trim();
  const visiveis = grupos
    .map((grupo) => ({
      ...grupo,
      opcoes: grupo.opcoes.filter((opcao) => normalizeSearch(opcao.label).includes(busca)),
    }))
    .filter((grupo) => grupo.opcoes.length > 0);
  const options = visiveis.flatMap((grupo) => grupo.opcoes);
  const atual = grupos.flatMap((grupo) => grupo.opcoes).find((opcao) => opcao.value === value);
  const active = options[Math.min(activeIndex, options.length - 1)];
  const optionId = (option: DeckOption) => `${id}-option-${options.indexOf(option)}`;

  // O popover fica acima dos painéis com overflow, inclusive no construtor.
  useLayoutEffect(() => {
    if (!open) return;
    function updatePosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const below = viewportTop + viewportHeight - rect.bottom - 14;
      const above = rect.top - viewportTop - 14;
      const upwards = below < Math.min(280, above);
      const width = Math.min(Math.max(rect.width, 240), viewportWidth - 16);
      setPosition({
        top: upwards ? rect.top - 6 : rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, viewportWidth - width - 8)),
        width,
        maxHeight: Math.max(100, Math.min(360, upwards ? above : below)),
        transform: upwards ? "translateY(-100%)" : undefined,
      });
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    // Rolagem da lista não muda a posição do seletor.
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && popupRef.current?.contains(event.target)) return;
      updatePosition();
    };
    window.addEventListener("scroll", onScroll, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", onScroll, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [open]);

  useEffect(() => {
    if (open) activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, query]);

  useEffect(() => {
    if (disabled) popupRef.current?.hidePopover();
  }, [disabled]);

  function choose(option: DeckOption) {
    onChange(option.value);
    popupRef.current?.hidePopover();
    triggerRef.current?.focus();
  }

  return (
    <div
      className={className}
      data-deck-select
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) popupRef.current?.hidePopover();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        popoverTarget={`${id}-popup`}
        aria-label={label}
        aria-describedby={`${id}-value`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-popup`}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            popupRef.current?.showPopover();
          }
        }}
        className={`flex items-center justify-between gap-2 text-left ${controlClassName}`}
      >
        <span id={`${id}-value`} className="min-w-0 truncate">{atual?.label ?? "Selecionar deck"}</span>
        <span aria-hidden="true" className={`shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      <div
        ref={popupRef}
        id={`${id}-popup`}
        popover="auto"
        role="dialog"
        aria-label={`Selecionar deck: ${label}`}
        style={position}
        onToggle={(event) => {
          const opened = event.newState === "open";
          setOpen(opened);
          if (opened) {
            setQuery("");
            const allOptions = grupos.flatMap((grupo) => grupo.opcoes);
            setActiveIndex(Math.max(0, allOptions.findIndex((option) => option.value === value)));
            inputRef.current?.focus({ preventScroll: true });
          }
        }}
        className="fixed m-0 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 p-0 text-zinc-100 shadow-2xl open:flex open:flex-col"
      >
        <div className="shrink-0 border-b border-zinc-800 p-2">
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            aria-label={`Pesquisar decks: ${label}`}
            aria-expanded={open}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={active ? optionId(active) : undefined}
            placeholder="Pesquisar decks..."
            autoComplete="off"
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const current = active ? options.indexOf(active) : -1;
                setActiveIndex(Math.max(0, Math.min(options.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))));
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (active) choose(active);
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                popupRef.current?.hidePopover();
                triggerRef.current?.focus();
              }
            }}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-amber-600"
          />
        </div>
        <div id={`${id}-list`} role="listbox" aria-label={label} className="min-h-0 overflow-y-auto p-1">
          {visiveis.map((grupo, groupIndex) => (
            <div key={grupo.label} role="group" aria-labelledby={`${id}-group-${groupIndex}`}>
              <p id={`${id}-group-${groupIndex}`} className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-amber-500/80">
                {grupo.label}
              </p>
              {grupo.opcoes.map((opcao) => (
                <button
                  key={opcao.value}
                  ref={opcao === active ? activeRef : undefined}
                  id={optionId(opcao)}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={opcao.value === value}
                  data-value={opcao.value}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => choose(opcao)}
                  className={`flex w-full items-start justify-between gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-zinc-800 ${opcao === active ? "bg-zinc-800" : ""} ${opcao.value === value ? "text-amber-300" : "text-zinc-200"}`}
                >
                  <span>{opcao.label}</span>
                  {opcao.value === value && <span aria-hidden="true">✓</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
        {options.length === 0 && (
          <p role="status" className="p-4 text-center text-sm text-zinc-400">
            Nenhum deck encontrado.
          </p>
        )}
      </div>
    </div>
  );
}
