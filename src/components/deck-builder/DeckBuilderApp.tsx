"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { PresetDeckPicker } from "@/components/deck-builder/PresetDeckPicker";
import { DeckSearchSelect } from "@/components/deck-builder/DeckSearchSelect";
import { CardDetailsDialog } from "@/components/layout/CardDetailsDialog";
import { CardImageZoom } from "@/components/layout/CardImageZoom";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { GlossaryText } from "@/components/duel/GlossaryText";
import {
  DeckStatsDialog,
  ImportExportDialog,
  TestHandDialog,
} from "@/components/deck-builder/DeckTools";
import { useCardRegistry } from "@/context/CardRegistryProvider";
import { usePlayer } from "@/context/PlayerProvider";
import { useCardText } from "@/hooks/useCardText";
import { useDeck, type DeckLibrary } from "@/hooks/useDeck";
import {
  attributeLabel,
  translateBanlist,
  translateRace,
  translateType,
} from "@/lib/card-labels";
import {
  ATTRIBUTE_OPTIONS,
  BANLIST_OPTIONS,
  CATEGORY_OPTIONS,
  EMPTY_FILTERS,
  MONSTER_KIND_OPTIONS,
  SORT_OPTIONS,
  activeFilterCount,
  applyCardFilters,
  availableLevels,
  availableLinkRatings,
  availableRaces,
  availableRanks,
  availableScales,
  isLink,
  isXyz,
  type CardFilters,
  type MonsterKind,
} from "@/lib/domain/card-filters";
import {
  banStatus,
  banlistName,
  banlistSummary,
  canAddCard,
  cardsOutsidePool,
  countInZone,
  deckLimits,
  deckValidationMessages,
  getDefaultZone,
  MAX_COPIES_PER_CARD,
  isDeckDuelReady,
  isInFormatPool,
} from "@/lib/domain/deck-rules";
import { VirtualCardGrid } from "@/components/deck-builder/VirtualCardGrid";
import { FORMAT_RULES, formatOf } from "@/lib/types";
import type { CardDefinition, DeckList, DeckZone, DuelFormat } from "@/lib/types";

/**
 * Arrastar e soltar entre o catálogo e o deck. O dado viaja num tipo próprio
 * para que arrastar texto ou um arquivo para a tela não seja confundido com
 * uma carta.
 */
const DRAG_TYPE = "application/x-yugioh-card";
type DragPayload = { passcode: number; origem: "catalogo" | "deck"; zone?: DeckZone };

function lerArrasto(event: React.DragEvent): DragPayload | null {
  try {
    const bruto = event.dataTransfer.getData(DRAG_TYPE);
    return bruto ? (JSON.parse(bruto) as DragPayload) : null;
  } catch {
    return null;
  }
}

const ZONE_TABS: { value: DeckZone; label: string }[] = [
  { value: "main", label: "Principal" },
  { value: "extra", label: "Extra" },
  { value: "side", label: "Side" },
];

export function DeckBuilderApp() {
  const { cards: catalogo, isLoading, error, reload, registry } = useCardRegistry();
  const {
    deck,
    library,
    countByPasscode,
    lastActionError,
    clearLastActionError,
    tryAddCard,
    tryRemoveCard,
    tryClearDeck,
    renameDeck,
    changeFormat,
    loadPreset,
    undo,
    canUndo,
    importDeck,
  } = useDeck();
  const formato = formatOf(deck.format);
  // O catálogo traz o TCG inteiro; o construtor mostra o pool do formato do
  // deck aberto — o de abril de 2005 num deck Goat.
  const cards = useMemo(
    () => catalogo.filter((card) => isInFormatPool(card, formato)),
    [catalogo, formato],
  );

  const [preview, setPreview] = useState<CardDefinition | null>(null);
  const [zone, setZone] = useState<DeckZone>("main");
  const [filters, setFilters] = useState<CardFilters>(EMPTY_FILTERS);
  const [feedback, setFeedback] = useState<string | null>(null);
  /** Ferramenta aberta: mão de teste, estatísticas, importar/exportar. */
  const [ferramenta, setFerramenta] = useState<"mao" | "stats" | "io" | null>(null);
  const [mobileTab, setMobileTab] = useState<"catalog" | "deck" | "library">("catalog");
  const [reading, setReading] = useState<{ code: number; zone: DeckZone } | null>(null);
  const closeReading = useCallback(() => setReading(null), []);
  const readingCard = reading ? registry?.get(reading.code) : undefined;
  const addResult = reading && readingCard ? canAddCard(deck, readingCard, reading.zone) : null;
  const readingContext = `${deck.id}:${formato}`;
  const [previousContext, setPreviousContext] = useState(readingContext);
  if (previousContext !== readingContext) {
    setPreviousContext(readingContext);
    setReading(null);
    setPreview(null);
  }
  function inspect(code: number, target: DeckZone) {
    setPreview(registry?.get(code) ?? null);
    setReading({ code, zone: target });
    setFeedback(null);
    clearLastActionError();
  }

  // Ctrl+Z (⌘Z no Mac) desfaz a última edição de carta — menos quando o foco
  // está num campo de texto, onde o desfazer é o do próprio campo.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z" || event.shiftKey) return;
      const alvo = event.target as HTMLElement | null;
      if (alvo && ["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName)) return;
      event.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  const activeFeedback = feedback ?? lastActionError ?? library.saveError;

  const catalog = useMemo(
    () => applyCardFilters(cards, filters, formato),
    [cards, filters, formato],
  );

  // As opções de raça/nível seguem a categoria escolhida: filtrar "Magias" não
  // deve oferecer "Dragão", e filtrar "Monstros" não deve oferecer "Rápida".
  const scoped = useMemo(
    () =>
      applyCardFilters(cards, {
        ...EMPTY_FILTERS,
        category: filters.category,
      }),
    [cards, filters.category],
  );
  const raceOptions = useMemo(() => availableRaces(scoped), [scoped]);
  const levelOptions = useMemo(() => availableLevels(scoped), [scoped]);
  const rankOptions = useMemo(() => availableRanks(scoped), [scoped]);
  const linkOptions = useMemo(() => availableLinkRatings(scoped), [scoped]);
  const scaleOptions = useMemo(() => availableScales(scoped), [scoped]);

  /** Cartas do deck que não são do pool do formato (marcadas na grade). */
  const foraDoPool = useMemo(
    () => new Set(cardsOutsidePool(deck, registry)),
    [deck, registry],
  );

  function patch(next: Partial<CardFilters>) {
    setFilters((current) => ({ ...current, ...next }));
  }

  function handleAdd(card: CardDefinition) {
    clearLastActionError();
    setFeedback(null);
    // O side deck só recebe cartas quando é a aba ativa; fora dele a carta vai
    // para a zona natural dela (extra para fusões, principal para o resto).
    tryAddCard(card, zone === "side" ? "side" : getDefaultZone(card));
  }

  if (isLoading) {
    return (
      <div className="deck-builder flex flex-1 items-center justify-center p-8">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-[color:var(--tf-gold)] border-t-transparent" />
          <p className="text-sm text-zinc-400">
            Carregando o catálogo de cartas...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="deck-builder flex flex-1 items-center justify-center p-8">
        <div className="tf-panel max-w-md rounded-lg p-6 text-center">
          <p className="text-red-300">{error}</p>
          <button
            type="button"
            onClick={() => void reload()}
            className="mt-4 rounded bg-[color:var(--tf-gold)] px-4 py-2 text-sm font-semibold text-black hover:brightness-110"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-builder-tab={mobileTab} className="deck-builder flex min-h-0 flex-1 flex-col overflow-hidden">
      {activeFeedback && (
        <div className="flex shrink-0 items-center justify-between border-b border-red-900/50 bg-red-950/60 px-4 py-2 text-sm text-red-200">
          <span role="status">{activeFeedback}</span>
          <button
            type="button"
            onClick={() => {
              setFeedback(null);
              clearLastActionError();
            }}
            className="ml-4 shrink-0 text-red-300 hover:text-red-100"
          >
            ✕
          </button>
        </div>
      )}

      <div className="builder-mobile-bar">
        <p className="truncate text-sm font-semibold text-amber-200">{deck.name}</p>
        <nav aria-label="Construtor de decks" className="builder-tabs">
          {([
            ["catalog", "Cartas"],
            ["deck", `Meu deck · ${countInZone(deck, "main")}`],
            ["library", "Biblioteca"],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={mobileTab === value} onClick={() => setMobileTab(value)} data-builder-nav={value}>
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="builder-layout grid min-h-0 flex-1 gap-2 p-2 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* ---------- coluna de detalhe (estilo Tag Force) ---------- */}
        <aside className="builder-library flex min-h-0 flex-col gap-2 overflow-hidden">
          <DeckLibraryBar library={library} />
          <DeckHeader
            deck={deck}
            registry={registry}
            onRename={renameDeck}
            onClear={tryClearDeck}
            onUndo={undo}
            canUndo={canUndo}
            onTool={setFerramenta}
            onLoadPreset={loadPreset}
            onChangeFormat={(format) => {
              changeFormat(format);
              // Os filtros do formato anterior (um Rank no TCG) não fazem
              // sentido no outro.
              setFilters(EMPTY_FILTERS);
            }}
          />
          <div className="builder-desktop-preview flex min-h-0 flex-1 flex-col">
            <BigCardPreview card={preview} format={formato} />
          </div>
        </aside>

        {/* ---------- deck + catálogo ---------- */}
        <section className="builder-workspace flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden">
          <DeckGrid
            deck={deck}
            zone={zone}
            onZoneChange={setZone}
            registry={registry}
            foraDoPool={foraDoPool}
            selectedCode={reading?.code}
            onInspect={(code) => inspect(code, zone)}
            onDropFromCatalog={(passcode) => {
              const card = registry?.get(passcode);
              if (card) handleAdd(card);
            }}
          />

          {/* O catálogo também recebe: soltar aqui uma carta arrastada do deck
              a tira dele — o "arrastar para fora" do Master Duel. */}
          <div
            data-catalog-drop
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes(DRAG_TYPE)) event.preventDefault();
            }}
            onDrop={(event) => {
              const arrasto = lerArrasto(event);
              if (arrasto?.origem !== "deck") return;
              event.preventDefault();
              tryRemoveCard(arrasto.passcode, arrasto.zone ?? zone);
              setFeedback(null);
              clearLastActionError();
            }}
            className="builder-catalog tf-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-md"
          >
            <FilterBar
              filters={filters}
              onPatch={patch}
              onReset={() => setFilters(EMPTY_FILTERS)}
              raceOptions={raceOptions}
              levelOptions={levelOptions}
              rankOptions={rankOptions}
              linkOptions={linkOptions}
              scaleOptions={scaleOptions}
              format={formato}
              resultCount={catalog.length}
            />

            {catalog.length === 0 && <p role="status" className="p-6 text-center text-sm text-zinc-400">Nenhuma carta encontrada. Tente outro nome ou limpe os filtros.</p>}
            <VirtualCardGrid
              items={catalog}
              itemKey={(card) => card.passcode}
              resetKey={`${formato}|${JSON.stringify(filters)}`}
              render={(card) => (
                <CatalogCard
                  card={card}
                  format={formato}
                  inDeck={countByPasscode.get(card.passcode) ?? 0}
                  selected={reading?.code === card.passcode}
                  onInspect={() => inspect(card.passcode, zone === "side" ? "side" : getDefaultZone(card))}
                />
              )}
            />
          </div>
        </section>
      </div>

      {reading && (
        <CardDetailsDialog
          code={reading.code}
          registry={registry}
          onClose={closeReading}
          actions={
            <>
              <div className="builder-reader-notice w-full space-y-1 overflow-y-auto">
              <p role="status" className="w-full text-center text-sm text-zinc-300">
                {ZONE_TABS.find((tab) => tab.value === reading.zone)?.label} · {deck[reading.zone].find((ref) => ref.passcode === reading.code)?.quantity ?? 0} cópia(s) nesta zona · {countByPasscode.get(reading.code) ?? 0}/3 no deck
              </p>
              <p data-reader-banlist className="w-full text-center text-sm text-amber-200">
                {readingCard ? `${translateBanlist(banStatus(readingCard, formato) ?? undefined) ?? "Sem restrição"} · ${banlistName(formato)}.` : "Carta indisponível no catálogo. Você pode removê-la do deck."}
                {readingCard && " A banlist é apenas um aviso; o construtor permite até 3 cópias."}
              </p>
              {addResult && !addResult.ok && <p role="status" className="w-full text-center text-sm text-zinc-300">{addResult.reason}</p>}
              {activeFeedback && <p role="status" className="w-full text-center text-sm text-red-200">{activeFeedback}</p>}
              </div>
              <button type="button" data-reader-remove className="md-pill md-pill-ghost flex-1 px-4" disabled={!deck[reading.zone].some((ref) => ref.passcode === reading.code)} onClick={() => {
                tryRemoveCard(reading.code, reading.zone);
                setFeedback(null);
                clearLastActionError();
              }}>− Remover</button>
              <button type="button" data-reader-add className="md-pill md-pill-primary flex-1 px-4" disabled={!addResult?.ok} onClick={() => {
                clearLastActionError();
                setFeedback(null);
                if (readingCard) tryAddCard(readingCard, reading.zone);
              }}>+ Adicionar</button>
            </>
          }
        />
      )}

      {ferramenta === "mao" && (
        <TestHandDialog deck={deck} registry={registry} onClose={() => setFerramenta(null)} onHover={setPreview} />
      )}
      {ferramenta === "stats" && (
        <DeckStatsDialog deck={deck} registry={registry} onClose={() => setFerramenta(null)} />
      )}
      {ferramenta === "io" && (
        <ImportExportDialog
          deck={deck}
          registry={registry}
          onImport={importDeck}
          onClose={() => setFerramenta(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * A biblioteca de decks do jogador.
 *
 * Antes existia exatamente UM deck, sob uma chave do `localStorage`: montar um
 * segundo significava apagar o primeiro. Agora a lista mora no servidor (ver
 * `src/server/decks/store.ts`), então sobrevive a uma limpeza de dados do
 * navegador e aparece igual em qualquer aparelho da rede.
 */
/** O nome do jogador, editável sem sair do construtor. */
function NomeDoJogador() {
  const { profile, setName } = usePlayer();
  if (!profile) return null;

  return (
    <input
      value={profile.name}
      onChange={(event) => setName(event.target.value)}
      aria-label="Seu nome"
      maxLength={40}
      className="w-28 rounded border border-transparent bg-transparent px-1 text-right text-[10px] text-zinc-500 outline-none hover:border-[color:var(--tf-slot-border)] focus:border-[color:var(--tf-gold)] focus:text-zinc-200"
    />
  );
}

function DeckLibraryBar({ library }: { library: DeckLibrary }) {
  const { decks, selectedId, select, create, duplicate, remove } = library;
  const [confirmando, setConfirmando] = useState(false);

  if (!decks) {
    return (
      <div className="tf-panel shrink-0 rounded-md p-3 text-[11px] text-zinc-500">
        Carregando seus decks...
      </div>
    );
  }

  const acao =
    "rounded border border-[color:var(--tf-slot-border)] px-2 py-1 text-[11px] text-zinc-300 transition hover:bg-black/60";

  return (
    <div className="tf-panel shrink-0 space-y-2 rounded-md p-3">
      <div className="flex items-center justify-between">
        <p className="text-[9px] uppercase tracking-[0.15em] text-[color:var(--tf-gold-dim)]">
          Seus decks ({decks.length})
        </p>
        <NomeDoJogador />
      </div>

      <DeckSearchSelect
        value={selectedId ?? ""}
        onChange={select}
        label="Deck aberto"
        controlClassName="w-full rounded border border-[color:var(--tf-slot-border)] bg-black/50 px-2 py-1.5 text-[12px] text-zinc-100 outline-none focus:border-[color:var(--tf-gold)] disabled:opacity-50"
        grupos={[{
          label: "Seus decks",
          opcoes: decks.map((item) => ({
            value: item.id,
            label: `${item.name} · ${item.main.reduce((soma, ref) => soma + ref.quantity, 0)} cartas`,
          })),
        }]}
      />

      <div className="flex gap-1.5">
        <button type="button" onClick={create} className={`${acao} flex-1`}>
          Novo
        </button>
        <button type="button" onClick={duplicate} className={`${acao} flex-1`}>
          Duplicar
        </button>
        {/*
          Apagar pede confirmação no próprio botão em vez de um `confirm()`:
          é a única ação daqui que não dá para desfazer, e um clique errado
          levaria o deck junto.
        */}
        <button
          type="button"
          onClick={() => {
            if (!selectedId) return;
            if (!confirmando) {
              setConfirmando(true);
              setTimeout(() => setConfirmando(false), 3000);
              return;
            }
            setConfirmando(false);
            remove(selectedId);
          }}
          className={`${acao} flex-1 ${
            confirmando ? "border-red-700 bg-red-950/60 text-red-200" : ""
          }`}
        >
          {confirmando ? "Confirmar?" : "Apagar"}
        </button>
      </div>
    </div>
  );
}

function FilterBar({
  filters,
  onPatch,
  onReset,
  raceOptions,
  levelOptions,
  rankOptions,
  linkOptions,
  scaleOptions,
  format,
  resultCount,
}: {
  filters: CardFilters;
  onPatch: (next: Partial<CardFilters>) => void;
  onReset: () => void;
  raceOptions: string[];
  levelOptions: number[];
  rankOptions: number[];
  linkOptions: number[];
  scaleOptions: number[];
  format: DuelFormat;
  resultCount: number;
}) {
  const active = activeFilterCount(filters);
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const isMonsterScope =
    filters.category === "monster" ||
    filters.category === "extra" ||
    filters.category === "all";

  return (
    <div className="builder-filter-bar shrink-0 space-y-1.5 border-b border-[color:var(--tf-slot-border)] px-3 py-2">
      <div className="builder-search flex flex-wrap items-center gap-2">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-[color:var(--tf-gold)]">
          Catálogo
        </h2>
        <input
          value={filters.search}
          onChange={(event) => onPatch({ search: event.target.value })}
          placeholder="Buscar por nome ou texto do efeito..."
          aria-label="Buscar cartas"
          type="search"
          className="min-w-0 flex-1 rounded border border-[color:var(--tf-slot-border)] bg-black/50 px-2.5 py-1.5 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-[color:var(--tf-gold)]"
        />
        <div className="builder-categories flex gap-1" role="group" aria-label="Categoria das cartas">
          {CATEGORY_OPTIONS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              aria-pressed={filters.category === entry.value}
              onClick={() =>
                // Trocar de categoria invalida raça/nível da categoria anterior.
                onPatch({
                  category: entry.value,
                  race: "",
                  level: null,
                  kind: "",
                  rank: null,
                  linkRating: null,
                  scale: null,
                })
              }
              className={`rounded px-2.5 py-1.5 text-[11px] font-semibold transition ${
                filters.category === entry.value
                  ? "bg-[color:var(--tf-gold)] text-black"
                  : "border border-[color:var(--tf-slot-border)] text-[color:var(--tf-gold-dim)] hover:text-[color:var(--tf-gold-bright)]"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <details className="builder-filters" open={desktop || filtersOpen} onToggle={(event) => {
        if (!desktop) setFiltersOpen(event.currentTarget.open);
      }}>
        <summary>Filtros e ordem{active > 0 ? ` · ${active} ativo(s)` : ""} <span>{resultCount} cartas</span></summary>
        <div className="builder-filter-options flex flex-wrap items-center gap-1.5">
        {isMonsterScope && (
          <FilterSelect
            label="Atributo"
            value={filters.attribute}
            onChange={(value) => onPatch({ attribute: value })}
            options={ATTRIBUTE_OPTIONS}
          />
        )}

        <FilterSelect
          label={isMonsterScope ? "Tipo" : "Subtipo"}
          value={filters.race}
          onChange={(value) => onPatch({ race: value })}
          options={raceOptions.map((race) => ({
            value: race,
            label: translateRace(race) ?? race,
          }))}
        />

        {isMonsterScope && (
          <FilterSelect
            label="Monstro"
            value={filters.kind}
            onChange={(value) => onPatch({ kind: value as MonsterKind | "" })}
            options={MONSTER_KIND_OPTIONS.filter(
              (option) => format === "tcg" || !option.tcgOnly,
            )}
          />
        )}

        {isMonsterScope && levelOptions.length > 0 && (
          <FilterSelect
            label="Nível"
            value={filters.level === null ? "" : String(filters.level)}
            onChange={(value) =>
              onPatch({ level: value === "" ? null : Number(value) })
            }
            options={levelOptions.map((level) => ({
              value: String(level),
              label: `Nv. ${level}`,
            }))}
          />
        )}

        {isMonsterScope && rankOptions.length > 0 && (
          <FilterSelect
            label="Rank"
            value={filters.rank === null ? "" : String(filters.rank)}
            onChange={(value) => onPatch({ rank: value === "" ? null : Number(value) })}
            options={rankOptions.map((rank) => ({ value: String(rank), label: `Rank ${rank}` }))}
          />
        )}

        {isMonsterScope && linkOptions.length > 0 && (
          <FilterSelect
            label="Link"
            value={filters.linkRating === null ? "" : String(filters.linkRating)}
            onChange={(value) =>
              onPatch({ linkRating: value === "" ? null : Number(value) })
            }
            options={linkOptions.map((rating) => ({ value: String(rating), label: `Link-${rating}` }))}
          />
        )}

        {isMonsterScope && scaleOptions.length > 0 && (
          <FilterSelect
            label="Escala"
            value={filters.scale === null ? "" : String(filters.scale)}
            onChange={(value) => onPatch({ scale: value === "" ? null : Number(value) })}
            options={scaleOptions.map((scale) => ({ value: String(scale), label: `Escala ${scale}` }))}
          />
        )}

        <FilterSelect
          label={format === "tcg" ? "Banlist TCG" : "Lista 2005"}
          value={filters.banlist}
          onChange={(value) => onPatch({ banlist: value })}
          options={BANLIST_OPTIONS}
        />

        {isMonsterScope && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider text-[color:var(--tf-gold-dim)]">
              ATK
            </span>
            <NumberInput
              placeholder="mín"
              value={filters.minAtk}
              onChange={(value) => onPatch({ minAtk: value })}
            />
            <NumberInput
              placeholder="máx"
              value={filters.maxAtk}
              onChange={(value) => onPatch({ maxAtk: value })}
            />
          </div>
        )}

        <FilterSelect
          label="Ordenar"
          value={filters.sort}
          onChange={(value) => onPatch({ sort: value as CardFilters["sort"] })}
          options={SORT_OPTIONS}
          allowEmpty={false}
        />

        {active > 0 && (
          <button
            type="button"
            onClick={onReset}
            className="rounded border border-[color:var(--tf-gold)] px-2 py-1 text-[10px] font-semibold text-[color:var(--tf-gold-bright)] transition hover:bg-[color:var(--tf-gold)] hover:text-black"
          >
            Limpar filtros ({active})
          </button>
        )}

        <span className="ml-auto text-[11px] text-zinc-500">
          {resultCount} cartas
        </span>
        </div>
      </details>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allowEmpty = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  allowEmpty?: boolean;
}) {
  return (
    <label className="flex items-center gap-1">
      <span className="text-[10px] uppercase tracking-wider text-[color:var(--tf-gold-dim)]">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`rounded border bg-black/60 px-2 py-1.5 text-[11px] text-zinc-100 outline-none focus:border-[color:var(--tf-gold)] ${
          value
            ? "border-[color:var(--tf-gold)]"
            : "border-[color:var(--tf-slot-border)]"
        }`}
      >
        {allowEmpty && <option value="">Todos</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberInput({
  value,
  placeholder,
  onChange,
}: {
  value: number | null;
  placeholder: string;
  onChange: (value: number | null) => void;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      value={value === null ? "" : value}
      placeholder={placeholder}
      onChange={(event) => {
        const raw = event.target.value;
        onChange(raw === "" ? null : Number(raw));
      }}
      className={`w-14 rounded border bg-black/60 px-1.5 py-1 text-[10px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-[color:var(--tf-gold)] ${
        value === null
          ? "border-[color:var(--tf-slot-border)]"
          : "border-[color:var(--tf-gold)]"
      }`}
    />
  );
}

function DeckHeader({
  deck,
  registry,
  onRename,
  onClear,
  onUndo,
  canUndo,
  onTool,
  onLoadPreset,
  onChangeFormat,
}: {
  deck: DeckList;
  registry: ReturnType<typeof useCardRegistry>["registry"];
  onRename: (name: string) => void;
  onClear: () => void;
  onUndo: () => void;
  canUndo: boolean;
  onTool: (tool: "mao" | "stats" | "io") => void;
  onLoadPreset: Parameters<typeof PresetDeckPicker>[0]["onSelect"];
  onChangeFormat: (format: DuelFormat) => void;
}) {
  /** "Limpar" pede confirmação no próprio botão, como o "Apagar". */
  const [confirmandoLimpar, setConfirmandoLimpar] = useState(false);
  const formato = formatOf(deck.format);
  const limites = deckLimits(formato);
  const foraDoPool = cardsOutsidePool(deck, registry);
  const ready = isDeckDuelReady(deck) && foraDoPool.length === 0;
  const avisos = deckValidationMessages(deck);
  const banlist = banlistSummary(deck, registry);

  return (
    <div className="tf-panel shrink-0 space-y-2 rounded-md p-3">
      <input
        value={deck.name}
        onChange={(event) => onRename(event.target.value)}
        aria-label="Nome do deck"
        className="w-full rounded border border-[color:var(--tf-slot-border)] bg-black/50 px-2 py-1.5 text-base font-semibold text-[color:var(--tf-gold-bright)] outline-none focus:border-[color:var(--tf-gold)]"
      />

      {/* Formato do deck: decide o pool, os limites, a banlist que aparece
          e as regras do duelo. Trocar não apaga carta — o que sair do pool
          fica marcado. */}
      <div data-format-switch className="grid grid-cols-2 gap-1">
        {(["goat", "tcg"] as const).map((opcao) => (
          <button
            key={opcao}
            type="button"
            onClick={() => onChangeFormat(opcao)}
            aria-pressed={formato === opcao}
            title={
              opcao === "goat"
                ? "Goat Format — o pool e as regras de abril de 2005"
                : "TCG de hoje — pool inteiro, Master Rule 2020"
            }
            className={`rounded px-2 py-1 text-[11px] font-bold transition ${
              formato === opcao
                ? "bg-[color:var(--tf-gold)] text-black"
                : "border border-[color:var(--tf-slot-border)] text-[color:var(--tf-gold-dim)] hover:text-[color:var(--tf-gold-bright)]"
            }`}
          >
            {FORMAT_RULES[opcao].label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-1 text-center">
        {ZONE_TABS.map((tab) => {
          const count = countInZone(deck, tab.value);
          const limit = limites[tab.value];
          const bad = count > limit.max || (tab.value === "main" && count < limit.min);
          return (
            <div
              key={tab.value}
              className="rounded border border-[color:var(--tf-slot-border)] bg-black/40 px-1 py-1"
            >
              <p className="text-[8px] uppercase tracking-wider text-[color:var(--tf-gold-dim)]">
                {tab.label}
              </p>
              <p
                className={`font-mono text-base font-bold ${
                  bad ? "text-red-300" : "text-[color:var(--tf-gold-bright)]"
                }`}
              >
                {count}
                <span className="text-[9px] text-zinc-500">/{limit.max}</span>
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5">
        {ready ? (
          <Link
            href="/duel"
            className="flex-1 rounded bg-[color:var(--tf-gold)] px-2 py-1.5 text-center text-[11px] font-bold text-black transition hover:brightness-110"
          >
            Duelar
          </Link>
        ) : (
          <span
            title={[...avisos, ...(foraDoPool.length ? [`${foraDoPool.length} carta(s) fora do pool`] : [])].join("\n")}
            className="flex-1 rounded border border-[color:var(--tf-slot-border)] px-2 py-1.5 text-center text-[10px] text-amber-200/70"
          >
            {foraDoPool.length > 0
              ? `${foraDoPool.length} carta(s) fora do pool ${formato === "tcg" ? "TCG" : "Goat"}`
              : avisos[0] ?? `Mín. ${limites.main.min} cartas`}
          </span>
        )}
        {/* Limpar apagava o deck inteiro num clique, sem volta. Agora pede
            confirmação — e mesmo confirmado, o "Desfazer" traz de volta. */}
        <button
          type="button"
          data-clear-deck
          onClick={() => {
            if (!confirmandoLimpar) {
              setConfirmandoLimpar(true);
              setTimeout(() => setConfirmandoLimpar(false), 3000);
              return;
            }
            setConfirmandoLimpar(false);
            onClear();
          }}
          className={`rounded border px-2 py-1.5 text-[11px] transition hover:bg-black/60 ${
            confirmandoLimpar
              ? "border-red-700 bg-red-950/60 text-red-200"
              : "border-[color:var(--tf-slot-border)] text-zinc-300"
          }`}
        >
          {confirmandoLimpar ? "Limpar tudo?" : "Limpar"}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-1">
        <button
          type="button"
          data-undo
          disabled={!canUndo}
          onClick={onUndo}
          title="Desfazer a última edição de carta (Ctrl+Z)"
          className="rounded border border-[color:var(--tf-slot-border)] px-1 py-1 text-[10px] text-zinc-300 transition hover:bg-black/60 disabled:opacity-35"
        >
          ↶ Desfazer
        </button>
        <button
          type="button"
          data-tool="mao"
          onClick={() => onTool("mao")}
          title="Embaralhar e comprar 5, como na partida"
          className="rounded border border-[color:var(--tf-slot-border)] px-1 py-1 text-[10px] text-zinc-300 transition hover:bg-black/60"
        >
          Mão de teste
        </button>
        <button
          type="button"
          data-tool="stats"
          onClick={() => onTool("stats")}
          title="Monstros, magias, armadilhas e a curva de nível"
          className="rounded border border-[color:var(--tf-slot-border)] px-1 py-1 text-[10px] text-zinc-300 transition hover:bg-black/60"
        >
          Estatísticas
        </button>
        <button
          type="button"
          data-tool="io"
          onClick={() => onTool("io")}
          title="Importar ou exportar .ydk e ydke://"
          className="rounded border border-[color:var(--tf-slot-border)] px-1 py-1 text-[10px] text-zinc-300 transition hover:bg-black/60"
        >
          .ydk / ydke
        </button>
      </div>

      {/* Banlist do formato — informação, nunca bloqueio. */}
      <p
        data-banlist-summary
        className={`text-[11px] ${banlist.ok ? "text-emerald-300/80" : "text-amber-300"}`}
      >
        {banlist.ok ? "✓ " : "⚠ "}
        {banlist.text}
      </p>

      <PresetDeckPicker onSelect={onLoadPreset} format={formato} />
    </div>
  );
}

/**
 * Situação da carta na banlist de abril de 2005, ou `null` se era livre.
 *
 * Rótulo, não regra: a lista continua à vista para quem quer montar algo legal
 * de época, mas não barra mais nada — ver `MAX_COPIES_PER_CARD`.
 */
function banlistStatus(card: CardDefinition, format: DuelFormat): string | null {
  return translateBanlist(banStatus(card, format) ?? undefined);
}

function BigCardPreview({
  card,
  format,
}: {
  card: CardDefinition | null;
  format: DuelFormat;
}) {
  const texto = useCardText();
  if (!card) {
    return (
      <div className="tf-panel flex min-h-0 flex-1 items-center justify-center rounded-md p-4 text-center text-[13px] text-zinc-500">
        Clique em uma carta
        <br />
        para ver os detalhes
      </div>
    );
  }

  const image = card.images[0]?.image_url ?? card.images[0]?.image_url_small;
  const maxCopies = MAX_COPIES_PER_CARD;

  return (
    <div className="tf-panel flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-md p-3">
      {image && (
        <CardImageZoom
          src={image}
          alt={texto.name(card)}
          hologram={card.type.includes("Monster") ? { code: card.passcode, attribute: card.attribute } : undefined}
          className="mx-auto h-[42%] max-w-full shrink-0 rounded border border-[color:var(--tf-slot-border)]"
        />
      )}

      <div className="shrink-0">
        <h3 className="text-[15px] font-bold leading-tight text-[color:var(--tf-gold-bright)]">
          {texto.name(card)}
        </h3>
        <p className="mt-1 text-[12px] text-zinc-400">
          {translateType(card.type)}
          {isLink(card)
            ? ` · Link-${card.linkval ?? "?"}`
            : isXyz(card)
              ? ` · Rank ${card.level ?? "?"}`
              : card.level
                ? ` · Nv. ${card.level}`
                : ""}
          {card.frameType.includes("pendulum") && card.scale !== undefined
            ? ` · Escala ${card.scale}`
            : ""}
        </p>
        {card.type.includes("Monster") && (
          <p className="mt-1 font-mono text-[13px] text-[color:var(--tf-gold)]">
            {attributeLabel(card.attribute) ?? "—"}
            {card.race ? ` · ${translateRace(card.race)}` : ""} · ATK {card.atk ?? "?"}
            {isLink(card) ? "" : ` / DEF ${card.def ?? "?"}`}
          </p>
        )}
        <p className="mt-1 text-[12px] text-zinc-500">
          Máx. {maxCopies} cópia(s)
          {/* A banlist é informação, não restrição — ver `MAX_COPIES_PER_CARD`. */}
          {banlistStatus(card, format) && (
            <span className="ml-2 text-amber-500/80">
              · {banlistStatus(card, format)} na {banlistName(format)}
            </span>
          )}
        </p>
      </div>

      <GlossaryText
        text={texto.desc(card)}
        className="min-h-0 flex-1 overflow-y-auto whitespace-pre-line pr-1 text-[13px] leading-relaxed text-zinc-200"
      />
    </div>
  );
}

function DeckGrid({
  deck,
  zone,
  onZoneChange,
  registry,
  foraDoPool,
  selectedCode,
  onDropFromCatalog,
  onInspect,
}: {
  deck: DeckList;
  zone: DeckZone;
  onZoneChange: (zone: DeckZone) => void;
  /** Uma carta do catálogo solta sobre o deck — adiciona. */
  onDropFromCatalog: (passcode: number) => void;
  registry: ReturnType<typeof useCardRegistry>["registry"];
  /** Cartas que não são do pool do formato do deck — marcadas em vermelho. */
  foraDoPool: Set<number>;
  selectedCode?: number;
  onInspect: (code: number) => void;
}) {
  const texto = useCardText();
  // Uma miniatura por cópia — é assim que o Tag Force mostra o deck, e deixa
  // claro de relance quantas cópias de cada carta você tem.
  const entries = deck[zone].flatMap((ref) => {
    const card = registry?.get(ref.passcode);
    return Array.from({ length: ref.quantity }, (_, copy) => ({
      key: `${ref.passcode}-${copy}`,
      card,
      passcode: ref.passcode,
    }));
  });

  const [alvoDoArrasto, setAlvoDoArrasto] = useState(false);

  return (
    <div
      data-deck-drop
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        setAlvoDoArrasto(true);
      }}
      onDragLeave={() => setAlvoDoArrasto(false)}
      onDrop={(event) => {
        setAlvoDoArrasto(false);
        const arrasto = lerArrasto(event);
        if (arrasto?.origem !== "catalogo") return;
        event.preventDefault();
        onDropFromCatalog(arrasto.passcode);
      }}
      className={`builder-deck tf-panel flex h-[38%] min-h-0 shrink-0 flex-col overflow-hidden rounded-md ${
        alvoDoArrasto ? "ring-2 ring-[color:var(--tf-gold)]" : ""
      }`}
    >
      <div className="builder-zone-tabs flex shrink-0 flex-wrap items-center gap-1 border-b border-[color:var(--tf-slot-border)] px-3 py-2">
        {ZONE_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => onZoneChange(tab.value)}
            aria-pressed={zone === tab.value}
            className={`rounded px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition ${
              zone === tab.value
                ? "bg-[color:var(--tf-gold)] text-black"
                : "border border-[color:var(--tf-slot-border)] text-[color:var(--tf-gold-dim)] hover:text-[color:var(--tf-gold-bright)]"
            }`}
          >
            {tab.label} {countInZone(deck, tab.value)}
          </button>
        ))}
        <span className="builder-deck-hint ml-auto text-[11px] italic text-zinc-500">
          Clique para ler ou editar as cópias
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {entries.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-zinc-600">
            Nenhuma carta aqui. Escolha uma carta no catálogo para adicionar.
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-1">
            {entries.map((entry) => (
              <button
                key={entry.key}
                type="button"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(
                    DRAG_TYPE,
                    JSON.stringify({ passcode: entry.passcode, origem: "deck", zone } satisfies DragPayload),
                  );
                  event.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => onInspect(entry.passcode)}
                data-builder-card={entry.passcode}
                data-builder-selected={selectedCode === entry.passcode || undefined}
                title={
                  (entry.card ? texto.name(entry.card) : String(entry.passcode)) +
                  (foraDoPool.has(entry.passcode) ? " — fora do pool deste formato" : "")
                }
                data-fora-do-pool={foraDoPool.has(entry.passcode) || undefined}
                className={`aspect-[59/86] overflow-hidden rounded-[3px] border transition hover:ring-2 hover:ring-red-400 ${
                  foraDoPool.has(entry.passcode)
                    ? "border-red-500 opacity-60 ring-2 ring-red-600"
                    : "border-[color:var(--tf-slot-border)]"
                }`}
              >
                {entry.card?.images[0]?.image_url_small ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={entry.card.images[0].image_url_small}
                    alt={texto.name(entry.card)}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full items-center justify-center bg-black/50 text-[8px] text-zinc-500">
                    ?
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CatalogCard({
  card,
  format,
  inDeck,
  onInspect,
  selected,
}: {
  card: CardDefinition;
  format: DuelFormat;
  inDeck: number;
  onInspect: () => void;
  selected: boolean;
}) {
  const texto = useCardText();
  const image = card.images[0]?.image_url_small;
  const maxCopies = MAX_COPIES_PER_CARD;
  const full = inDeck >= maxCopies;

  return (
    <button
      type="button"
      draggable={!full}
      onDragStart={(event) => {
        event.dataTransfer.setData(
          DRAG_TYPE,
          JSON.stringify({ passcode: card.passcode, origem: "catalogo" } satisfies DragPayload),
        );
        event.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onInspect}
      data-builder-card={card.passcode}
      data-builder-selected={selected || undefined}
      title={
        full
          ? `${texto.name(card)} — limite atingido (${maxCopies})`
          : `Ver ${texto.name(card)}`
      }
      className={`relative block aspect-[59/86] w-full overflow-hidden rounded-[3px] border border-[color:var(--tf-slot-border)] transition ${
        full
          ? "opacity-60"
          : "hover:ring-2 hover:ring-[color:var(--tf-gold)]"
      }`}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt={texto.name(card)}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="flex h-full items-center justify-center bg-black/50 p-1 text-[7px] leading-tight text-zinc-400">
          {texto.name(card)}
        </span>
      )}

      {inDeck > 0 && (
        <span className="absolute right-0 top-0 rounded-bl bg-[color:var(--tf-gold)] px-1 text-[9px] font-bold text-black">
          {inDeck}
        </span>
      )}
      {banlistStatus(card, format) && (
        <span className="absolute inset-x-0 bottom-0 bg-amber-950/85 text-center text-[7px] font-bold uppercase text-amber-200">
          {banlistStatus(card, format)}
        </span>
      )}
    </button>
  );
}
