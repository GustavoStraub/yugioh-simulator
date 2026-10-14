"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  filtrarGrupos,
  trechosDestacados,
  type GrupoBuscavel,
  type OpcaoBuscavel,
} from "@/lib/domain/deck-search";

/**
 * Lista suspensa de decks com busca — o seletor de deck do lobby contra o bot,
 * do lobby online e da sala de espera.
 *
 * Substitui o `<select>` nativo, que com ~100 decks TCG virava rolar a lista
 * inteira (e cuja busca por teclado só acha o que COMEÇA com a letra). Aqui o
 * campo de busca filtra por "contém", sem acento e sem caixa, palavra por
 * palavra (`deck-search.ts`), com o trecho achado destacado; os grupos
 * ("Meus decks", "TCG · Estruturais"…) continuam, e o que esvazia some.
 *
 * Teclado: ↓/↑ andam, Enter escolhe, Esc fecha; com o botão focado, começar a
 * digitar já abre a busca com a letra.
 */
export function DeckCombobox({
  grupos,
  value,
  onChange,
  disabled = false,
  rotulo,
  nome,
  className = "",
}: {
  grupos: GrupoBuscavel<OpcaoBuscavel>[];
  /** O valor escolhido (`""` vale como opção — o deck aberto no construtor). */
  value: string;
  onChange: (valor: string) => void;
  disabled?: boolean;
  /** Nome para leitores de tela ("Seu deck", "Deck do bot"). */
  rotulo: string;
  /** `data-deck-combobox` — por onde os testes acham cada seletor. */
  nome: string;
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [ativo, setAtivo] = useState(0);
  const [paraCima, setParaCima] = useState(false);
  const raizRef = useRef<HTMLDivElement | null>(null);
  const botaoRef = useRef<HTMLButtonElement | null>(null);
  const campoRef = useRef<HTMLInputElement | null>(null);
  const listaRef = useRef<HTMLDivElement | null>(null);
  const id = useId();

  const escolhida = acharEscolhida(grupos, value);

  const filtrados = useMemo(() => filtrarGrupos(grupos, busca), [grupos, busca]);
  /** As opções visíveis em ordem — é por esta lista que ↓/↑ andam. */
  const planas = useMemo(() => filtrados.flatMap((grupo) => grupo.opcoes), [filtrados]);
  const ativoSeguro = Math.min(ativo, Math.max(0, planas.length - 1));

  function abrir(textoInicial = "") {
    if (disabled) return;
    setBusca(textoInicial);
    // Abre com a escolha atual em foco (sem busca, ela está na lista).
    const indice = textoInicial ? 0 : grupos.flatMap((grupo) => grupo.opcoes).findIndex((o) => o.value === value);
    setAtivo(Math.max(0, indice));
    // Abre para cima quando não cabe embaixo (o seletor do bot fica no meio
    // da página, e no celular a lista caía fora da tela).
    const caixa = botaoRef.current?.getBoundingClientRect();
    if (caixa) {
      const embaixo = window.innerHeight - caixa.bottom;
      setParaCima(embaixo < 340 && caixa.top > embaixo);
    }
    setAberto(true);
  }

  function fechar(devolverFoco = true) {
    setAberto(false);
    setBusca("");
    if (devolverFoco) botaoRef.current?.focus();
  }

  function escolher(valor: string) {
    onChange(valor);
    fechar();
  }

  // Foco no campo de busca ao abrir.
  useEffect(() => {
    if (aberto) campoRef.current?.focus();
  }, [aberto]);

  // Clique fora fecha.
  useEffect(() => {
    if (!aberto) return;
    const fora = (event: MouseEvent | TouchEvent) => {
      if (!raizRef.current?.contains(event.target as Node)) fechar(false);
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("touchstart", fora);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("touchstart", fora);
    };
  }, [aberto]);

  // A opção ativa sempre à vista na lista rolável.
  useLayoutEffect(() => {
    if (!aberto) return;
    const lista = listaRef.current;
    const alvo = lista?.querySelector<HTMLElement>(`[data-combobox-index="${ativoSeguro}"]`);
    if (!lista || !alvo) return;
    const topo = alvo.offsetTop;
    const base = topo + alvo.offsetHeight;
    if (topo < lista.scrollTop + 28) lista.scrollTop = Math.max(0, topo - 28);
    else if (base > lista.scrollTop + lista.clientHeight) lista.scrollTop = base - lista.clientHeight;
  }, [aberto, ativoSeguro, busca]);

  function teclaNoCampo(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setAtivo((atual) => Math.min(planas.length - 1, Math.min(atual, planas.length - 1) + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setAtivo((atual) => Math.max(0, Math.min(atual, planas.length - 1) - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setAtivo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setAtivo(Math.max(0, planas.length - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const opcao = planas[ativoSeguro];
      if (opcao) escolher(opcao.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      fechar();
    } else if (event.key === "Tab") {
      fechar(false);
    }
  }

  function teclaNoBotao(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      abrir();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== " ") {
      // Começar a digitar com o botão focado já é buscar.
      event.preventDefault();
      abrir(event.key);
    }
  }

  const listaId = `${id}-lista`;
  const opcaoId = (indice: number) => `${id}-opcao-${indice}`;
  let indice = -1;

  return (
    <div
      ref={raizRef}
      data-deck-combobox={nome}
      data-value={value}
      className={`relative ${className}`}
    >
      <button
        ref={botaoRef}
        type="button"
        data-combobox-trigger
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-label={`${rotulo}: ${escolhida?.opcao.label ?? "nenhum"}`}
        onClick={() => (aberto ? fechar() : abrir())}
        onKeyDown={teclaNoBotao}
        className={`flex w-full items-center gap-3 rounded-lg border bg-zinc-900 px-3 py-2 text-left text-sm text-zinc-100 outline-none transition disabled:opacity-50 ${
          aberto ? "border-amber-600" : "border-zinc-700 hover:border-zinc-500 focus-visible:border-amber-600"
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate">{escolhida?.opcao.label ?? "Escolha um deck"}</span>
          {escolhida && (
            <span className="block truncate text-[11px] text-zinc-500">{escolhida.grupo}</span>
          )}
        </span>
        <svg aria-hidden viewBox="0 0 20 20" className={`h-4 w-4 shrink-0 text-zinc-400 transition ${aberto ? "rotate-180" : ""}`}>
          <path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {aberto && (
        <div
          data-combobox-panel
          className={`absolute left-0 right-0 z-50 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl shadow-black/70 ${
            paraCima ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
          <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
            <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-zinc-500">
              <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M13 13l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              ref={campoRef}
              data-combobox-search
              role="combobox"
              aria-expanded
              aria-controls={listaId}
              aria-autocomplete="list"
              aria-activedescendant={planas.length ? opcaoId(ativoSeguro) : undefined}
              aria-label={`Buscar ${rotulo.toLowerCase()}`}
              placeholder="Buscar pelo nome…"
              value={busca}
              onChange={(event) => {
                setBusca(event.target.value);
                setAtivo(0);
              }}
              onKeyDown={teclaNoCampo}
              className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
            />
            {busca && (
              <button
                type="button"
                aria-label="Limpar a busca"
                onClick={() => {
                  setBusca("");
                  setAtivo(0);
                  campoRef.current?.focus();
                }}
                className="rounded px-1 text-xs text-zinc-500 hover:text-zinc-200"
              >
                ✕
              </button>
            )}
          </div>

          <div ref={listaRef} id={listaId} role="listbox" aria-label={rotulo} className="max-h-72 overflow-y-auto py-1">
            {planas.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-zinc-500">
                Nenhum deck com &quot;{busca.trim()}&quot;.
              </p>
            ) : (
              filtrados.map((grupo) => (
                <div key={grupo.label} role="group" aria-label={grupo.label}>
                  <p className="sticky top-0 z-10 bg-zinc-950/95 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-amber-500/80">
                    {grupo.label}
                  </p>
                  {grupo.opcoes.map((opcao) => {
                    indice += 1;
                    const meu = indice;
                    const selecionada = opcao.value === value;
                    const realcada = meu === ativoSeguro;
                    return (
                      <div
                        key={`${grupo.label}-${opcao.value}`}
                        id={opcaoId(meu)}
                        role="option"
                        aria-selected={selecionada}
                        data-combobox-option={opcao.value}
                        data-label={opcao.label}
                        data-combobox-index={meu}
                        data-group={grupo.label}
                        onMouseMove={() => {
                          if (ativo !== meu) setAtivo(meu);
                        }}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => escolher(opcao.value)}
                        className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${
                          realcada ? "bg-amber-600/20 text-zinc-50" : "text-zinc-300"
                        }`}
                      >
                        <span aria-hidden className={`w-3 shrink-0 text-amber-400 ${selecionada ? "" : "invisible"}`}>
                          ✓
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {trechosDestacados(opcao.label, busca).map((trecho, i) =>
                            trecho.achado ? (
                              <mark key={i} className="rounded-sm bg-amber-500/30 text-amber-100">
                                {trecho.texto}
                              </mark>
                            ) : (
                              <span key={i}>{trecho.texto}</span>
                            ),
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <p className="border-t border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-500">
            {busca.trim()
              ? `${planas.length} deck${planas.length === 1 ? "" : "s"} encontrado${planas.length === 1 ? "" : "s"}`
              : `${planas.length} decks`}{" "}
            · ↑↓ para andar, Enter escolhe, Esc fecha
          </p>
        </div>
      )}
    </div>
  );
}

/** A opção escolhida e o grupo dela, para o botão mostrar os dois. */
function acharEscolhida(grupos: GrupoBuscavel<OpcaoBuscavel>[], value: string) {
  for (const grupo of grupos) {
    const opcao = grupo.opcoes.find((item) => item.value === value);
    if (opcao) return { opcao, grupo: grupo.label };
  }
  return null;
}
