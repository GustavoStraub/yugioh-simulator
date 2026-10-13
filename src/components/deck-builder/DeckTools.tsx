"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useCardText } from "@/hooks/useCardText";
import type { CardRegistry } from "@/lib/domain/card-registry";
import {
  deckZones,
  exportYdk,
  exportYdke,
  importDeckLists,
  parseDeckText,
} from "@/lib/domain/deck-codec";
import { deckStats } from "@/lib/domain/deck-stats";
import type { CardDefinition, DeckList } from "@/lib/types";

/**
 * Cor das barras da curva de nível. O dourado do app (`--tf-gold`) é claro
 * demais para marca de dado sobre o painel escuro (reprovou na faixa de
 * luminosidade do validador de paleta); este passa e continua sendo "o
 * dourado da mesa".
 */
const BAR_COLOR = "#a8862f";

/** Caixa comum das ferramentas: diálogo, Esc e clique fora fecham. */
function ToolDialog({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="tf-modal-scrim fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-deck-tool={title}
        onClick={(event) => event.stopPropagation()}
        className={`tf-modal flex max-h-full w-full flex-col overflow-hidden outline-none ${
          wide ? "max-w-[860px]" : "max-w-[560px]"
        }`}
      >
        <header className="tf-modal-head flex shrink-0 items-center justify-between px-4 py-2">
          <h3 className="text-base font-bold text-[color:var(--tf-gold-bright)]">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded px-2 py-1 text-sm text-zinc-400 hover:bg-black/50 hover:text-zinc-100"
          >
            ✕
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

/** Embaralha uma cópia (Fisher-Yates). Só em clique — nunca no render. */
function embaralhar<T>(lista: readonly T[]): T[] {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/**
 * Mão de teste: embaralha o Deck Principal e compra 5, com "+1" para ver a
 * compra do turno seguinte — o "Draw 5 Cards" do construtor do Master Duel.
 * É a pergunta que todo deck faz: "eu abro jogando?".
 */
export function TestHandDialog({
  deck,
  registry,
  onClose,
  onHover,
}: {
  deck: DeckList;
  registry: CardRegistry | null;
  onClose: () => void;
  onHover: (card: CardDefinition | null) => void;
}) {
  const texto = useCardText();
  const principal = useMemo(() => deckZones(deck).main, [deck]);
  const [ordem, setOrdem] = useState<number[] | null>(null);
  const [compradas, setCompradas] = useState(5);
  const mao = (ordem ?? []).slice(0, compradas);

  return (
    <ToolDialog title="Mão de teste" onClose={onClose} wide>
      {principal.length < 5 ? (
        <p className="text-sm text-zinc-400">O Deck Principal precisa de pelo menos 5 cartas.</p>
      ) : ordem === null ? (
        <div className="flex flex-col items-center gap-3 py-6">
          <p className="text-sm text-zinc-400">
            Embaralha as {principal.length} cartas do Deck Principal e compra 5.
          </p>
          <button
            type="button"
            data-test-hand-draw
            onClick={() => {
              setOrdem(embaralhar(principal));
              setCompradas(5);
            }}
            className="rounded bg-[color:var(--tf-gold)] px-5 py-2 text-sm font-bold text-black hover:brightness-110"
          >
            Comprar 5
          </button>
        </div>
      ) : (
        <>
          <div data-test-hand className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
            {mao.map((code, index) => {
              const definicao = registry?.get(code);
              const nome = definicao ? texto.name(definicao) : `Carta ${code}`;
              return (
                <div key={`${code}-${index}`} onMouseEnter={() => onHover(definicao ?? null)} title={nome}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={definicao?.images[0]?.image_url_small ?? `/card-images/small/${code}.jpg`}
                    alt={nome}
                    className="aspect-[59/86] w-full rounded-[3px] object-cover"
                  />
                  <p className="mt-0.5 truncate text-[10px] text-zinc-300">{nome}</p>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[12px] text-zinc-500">
              {mao.length} na mão · {principal.length - mao.length} no Deck
            </span>
            <span className="flex-1" />
            <button
              type="button"
              disabled={compradas >= principal.length}
              onClick={() => setCompradas((n) => n + 1)}
              className="rounded border border-[color:var(--tf-slot-border)] px-3 py-1.5 text-[12px] text-[color:var(--tf-gold-bright)] hover:bg-black/50 disabled:opacity-40"
            >
              +1 carta
            </button>
            <button
              type="button"
              onClick={() => {
                setOrdem(embaralhar(principal));
                setCompradas(5);
              }}
              className="rounded bg-[color:var(--tf-gold)] px-3 py-1.5 text-[12px] font-bold text-black hover:brightness-110"
            >
              Nova mão
            </button>
          </div>
        </>
      )}
    </ToolDialog>
  );
}

/**
 * Estatísticas do deck: quantos monstros, magias e armadilhas (números, não
 * gráfico — são três valores a ler, não a comparar de relance) e a curva de
 * nível dos monstros, que é onde um deck "pesado" aparece.
 */
export function DeckStatsDialog({
  deck,
  registry,
  onClose,
}: {
  deck: DeckList;
  registry: CardRegistry | null;
  onClose: () => void;
}) {
  const zonas = useMemo(() => deckZones(deck), [deck]);
  const stats = useMemo(() => deckStats(zonas.main, zonas.extra, registry), [zonas, registry]);
  const niveis = Array.from({ length: 12 }, (_, i) => i + 1);
  const maior = Math.max(1, ...niveis.map((nivel) => stats.levels.get(nivel) ?? 0));
  const comNivel = [...stats.levels.values()].reduce((a, b) => a + b, 0);

  const tiles: { rotulo: string; valor: number; marca: string }[] = [
    { rotulo: "Monstros", valor: stats.monsters, marca: "bg-orange-400" },
    { rotulo: "Magias", valor: stats.spells, marca: "bg-teal-400" },
    { rotulo: "Armadilhas", valor: stats.traps, marca: "bg-pink-400" },
  ];

  return (
    <ToolDialog title="Estatísticas do deck" onClose={onClose}>
      <div data-deck-stats className="grid grid-cols-3 gap-2">
        {tiles.map((tile) => (
          <div key={tile.rotulo} className="rounded border border-[color:var(--tf-slot-border)] bg-black/30 p-2">
            <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-400">
              <span aria-hidden className={`h-2 w-2 rounded-sm ${tile.marca}`} />
              {tile.rotulo}
            </p>
            <p className="font-mono text-2xl font-bold text-zinc-100">{tile.valor}</p>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">Deck Principal: {stats.main} cartas.</p>

      <h4 className="mt-4 text-[12px] font-semibold text-zinc-200">
        Curva de nível dos monstros <span className="font-normal text-zinc-500">({comNivel} com Nível)</span>
      </h4>
      {comNivel === 0 ? (
        <p className="mt-2 text-[12px] text-zinc-500">Nenhum monstro com Nível no Deck Principal.</p>
      ) : (
        <>
          {/* Barras finas, ponta arredondada só em cima (ancoradas na base), 2px
              de folga entre elas; o valor de cada uma na dica e na tabela. */}
          <div data-level-curve className="mt-2 flex h-28 items-end gap-[2px] border-b border-zinc-700 pb-px" role="img" aria-label="Curva de nível">
            {niveis.map((nivel) => {
              const n = stats.levels.get(nivel) ?? 0;
              return (
                <div key={nivel} className="group relative flex h-full flex-1 items-end" title={`Nível ${nivel}: ${n} carta(s)`}>
                  <div
                    className="w-full rounded-t-[4px] transition-[filter] group-hover:brightness-125"
                    style={{ height: `${(n / maior) * 100}%`, background: n ? BAR_COLOR : "transparent" }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex gap-[2px] text-center text-[10px] text-zinc-500">
            {niveis.map((nivel) => (
              <span key={nivel} className="flex-1">
                {nivel}
              </span>
            ))}
          </div>
          <table className="sr-only">
            <caption>Monstros por Nível</caption>
            <tbody>
              {niveis.map((nivel) => (
                <tr key={nivel}>
                  <th scope="row">Nível {nivel}</th>
                  <td>{stats.levels.get(nivel) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {stats.extra > 0 && (
        <p className="mt-4 text-[12px] text-zinc-300">
          <span className="font-semibold text-zinc-200">Extra Deck ({stats.extra}):</span>{" "}
          {[
            ["Fusão", stats.extraKinds.fusion],
            ["Sincro", stats.extraKinds.synchro],
            ["Xyz", stats.extraKinds.xyz],
            ["Link", stats.extraKinds.link],
            ["outros", stats.extraKinds.other],
          ]
            .filter(([, n]) => Number(n) > 0)
            .map(([rotulo, n]) => `${n} ${rotulo}`)
            .join(" · ")}
        </p>
      )}
    </ToolDialog>
  );
}

/**
 * Importar e exportar: `.ydk` (arquivo) e `ydke://` (link), os formatos do
 * EDOPro, do YGOPro e dos sites de deck. Importar abre um deck NOVO — nunca
 * escreve por cima do aberto.
 */
export function ImportExportDialog({
  deck,
  registry,
  onImport,
  onClose,
}: {
  deck: DeckList;
  registry: CardRegistry | null;
  onImport: (name: string, zonas: Pick<DeckList, "main" | "extra" | "side">) => void;
  onClose: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const link = useMemo(() => exportYdke(deck), [deck]);

  function baixar() {
    const blob = new Blob([exportYdk(deck)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${deck.name.replace(/[\\/:*?"<>|]+/g, "-") || "deck"}.ydk`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importar() {
    const lido = parseDeckText(texto);
    const total = lido.main.length + lido.extra.length + lido.side.length;
    if (total === 0) {
      setResultado(
        lido.errors.length ? `Nada importado: ${lido.errors.slice(0, 3).join("; ")}` : "Nada importado: o texto não tem cartas.",
      );
      return;
    }
    const zonas = importDeckLists(lido, (code) => Boolean(registry?.has(code) || registry?.get(code)));
    onImport(nomeArquivo ?? "Deck importado", zonas);
    const avisos = [
      zonas.unknown.length ? `${zonas.unknown.length} carta(s) desconhecida(s) ficaram de fora` : "",
      lido.errors.length ? `${lido.errors.length} linha(s) ilegível(is)` : "",
    ].filter(Boolean);
    setResultado(`Importado como deck novo (${total - zonas.unknown.length} cartas).${avisos.length ? ` ${avisos.join("; ")}.` : ""}`);
  }

  return (
    <ToolDialog title="Importar / exportar" onClose={onClose}>
      <h4 className="text-[12px] font-semibold uppercase tracking-wider text-[color:var(--tf-gold)]">Exportar</h4>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={baixar} className="rounded bg-[color:var(--tf-gold)] px-3 py-1.5 text-[12px] font-bold text-black hover:brightness-110">
          Baixar .ydk
        </button>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(
              () => setCopiado(true),
              () => setCopiado(false),
            );
          }}
          className="rounded border border-[color:var(--tf-slot-border)] px-3 py-1.5 text-[12px] text-[color:var(--tf-gold-bright)] hover:bg-black/50"
        >
          {copiado ? "Link copiado ✓" : "Copiar link ydke://"}
        </button>
      </div>
      <textarea
        readOnly
        value={link}
        aria-label="Link ydke do deck"
        data-ydke-export
        onFocus={(event) => event.currentTarget.select()}
        className="mt-2 h-16 w-full resize-none rounded border border-[color:var(--tf-slot-border)] bg-black/50 p-2 font-mono text-[10px] text-zinc-300"
      />

      <h4 className="mt-4 text-[12px] font-semibold uppercase tracking-wider text-[color:var(--tf-gold)]">Importar</h4>
      <p className="mt-1 text-[11px] text-zinc-500">Cole um link ydke:// ou o conteúdo de um .ydk — ou escolha o arquivo.</p>
      <input
        type="file"
        accept=".ydk,text/plain"
        aria-label="Arquivo .ydk"
        onChange={async (event) => {
          const arquivo = event.target.files?.[0];
          if (!arquivo) return;
          setNomeArquivo(arquivo.name.replace(/\.ydk$/i, ""));
          setTexto(await arquivo.text());
        }}
        className="mt-2 block text-[11px] text-zinc-400 file:mr-2 file:rounded file:border-0 file:bg-zinc-800 file:px-2 file:py-1 file:text-zinc-200"
      />
      <textarea
        value={texto}
        onChange={(event) => setTexto(event.target.value)}
        aria-label="Deck para importar"
        data-deck-import
        placeholder="ydke://…  ou  #main …"
        className="mt-2 h-24 w-full rounded border border-[color:var(--tf-slot-border)] bg-black/50 p-2 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-600"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={!texto.trim()}
          onClick={importar}
          className="rounded bg-[color:var(--tf-gold)] px-3 py-1.5 text-[12px] font-bold text-black hover:brightness-110 disabled:opacity-40"
        >
          Importar como deck novo
        </button>
        {resultado && (
          <span role="status" data-import-result className="text-[11px] text-zinc-300">
            {resultado}
          </span>
        )}
      </div>
    </ToolDialog>
  );
}
