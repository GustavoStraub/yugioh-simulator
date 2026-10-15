"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useCardRegistry } from "@/context/CardRegistryProvider";
import { usePlayer } from "@/context/PlayerProvider";
import { useDeckEscolha } from "@/hooks/useDeckEscolha";
import { DeckSelect } from "@/components/duel/DeckSelect";
import { DeckSelectionLayout } from "@/components/duel/DeckSelectionLayout";
import { deckToDuelPayload } from "@/lib/domain/deck-serializer";
import { isDeckDuelReady } from "@/lib/domain/deck-rules";
import { kindGroupLabel, presetToDuelPayload } from "@/lib/domain/preset-decks";
import { formatOf, type DuelDeckPayload } from "@/lib/types";
import { PRESET_DECKS } from "@/lib/data/preset-decks-catalog";
import {
  resolveFirstTurn,
  saveDuelSetup,
  type FirstTurnChoice,
} from "@/lib/duel/duel-storage";
import { DeckPreview } from "@/components/duel/DeckPreview";

/** As três escolhas de quem começa, na ordem em que aparecem. */
const PRIMEIRO_TURNO: { valor: FirstTurnChoice; rotulo: string; dica: string }[] = [
  { valor: "me", rotulo: "Eu", dica: "Você começa." },
  { valor: "bot", rotulo: "O bot", dica: "O bot começa — você joga em segundo." },
  { valor: "coin", rotulo: "🪙 Moeda", dica: "Sorteado a cada partida (a revanche joga a moeda de novo)." },
];

/** Um deck que o bot pode usar: um pronto, ou um da biblioteca do jogador. */
interface OpcaoDoBot {
  id: string;
  nome: string;
  cartas: number;
  deck: DuelDeckPayload;
  /** Rótulo do `<optgroup>`: a linha do deck pronto, ou "Seus decks". */
  grupo: string;
}

export function DuelLobby() {
  const router = useRouter();
  const { isLoading, error, registry } = useCardRegistry();
  /**
   * Quem começa. O core sempre dá o primeiro turno ao assento 0; antes o
   * jogador era sempre o 0 e sempre começava — e no Goat jogar primeiro ou
   * segundo muda o jogo (quem começa compra no primeiro turno).
   */
  const [primeiro, setPrimeiro] = useState<FirstTurnChoice>("me");
  const { profile } = usePlayer();
  const [opponentId, setOpponentId] = useState<string | null>(null);
  const [hoveredCode, setHoveredCode] = useState<number | null>(null);
  // A biblioteca inteira do jogador, não só o deck aberto no construtor —
  // quem montou cinco decks escolhe qual leva para a mesa.
  const meuDeck = useDeckEscolha();
  const duelReady = meuDeck.pronto;
  const formato = formatOf(meuDeck.deck.format);

  /**
   * Os decks do bot no MESMO formato do seu: Goat contra TCG não tem regra
   * comum. Além dos prontos, os decks da sua biblioteca — é o que permite
   * treinar contra um deck seu, e é o único adversário possível num formato
   * que ainda não tem deck pronto.
   */
  const opcoes = useMemo<OpcaoDoBot[]>(() => {
    const prontos = PRESET_DECKS.filter((preset) => formatOf(preset.format) === formato).map(
      (preset): OpcaoDoBot => ({
        id: preset.id,
        nome: preset.namePt,
        cartas: preset.main.length,
        deck: presetToDuelPayload(preset),
        // No TCG são ~100: agrupar pela linha (Estruturais, Lendários…) é o
        // que torna o `<select>` navegável.
        grupo: kindGroupLabel(preset.kind),
      }),
    );
    const meus = (meuDeck.biblioteca ?? [])
      .filter((deck) => deck.format === formato && isDeckDuelReady(deck))
      .map(
        (deck): OpcaoDoBot => ({
          id: deck.id,
          nome: deck.name,
          cartas: deck.main.reduce((total, ref) => total + ref.quantity, 0),
          deck: deckToDuelPayload(deck),
          grupo: "Seus decks",
        }),
      );
    return [...prontos, ...meus];
  }, [formato, meuDeck.biblioteca]);

  // Padrão: o segundo deck pronto (o primeiro costuma ser o do próprio Yugi).
  const opponent =
    opcoes.find((opcao) => opcao.id === opponentId) ?? opcoes[1] ?? opcoes[0] ?? null;

  /** Bot × bot: o seu deck (pilotado pelo bot) contra o deck escolhido. */
  function handleSpectate() {
    if (!duelReady || !opponent) return;
    saveDuelSetup({
      playerName: profile?.name || meuDeck.deckName,
      playerDeck: meuDeck.deck,
      opponentId: opponent.id,
      opponentName: opponent.nome,
      opponentDeck: opponent.deck,
      format: formato,
      spectate: true,
    });
    router.push("/duel/play");
  }

  function handleStart() {
    if (!duelReady || !opponent) return;

    saveDuelSetup({
      // O nome de quem joga, não o do deck: é ele que aparece na barra de LP.
      playerName: profile?.name || meuDeck.deckName,
      playerDeck: meuDeck.deck,
      opponentId: opponent.id,
      opponentName: opponent.nome,
      opponentDeck: opponent.deck,
      format: formato,
      firstTurn: primeiro,
      // A moeda cai aqui, no clique — e de novo a cada revanche.
      ...resolveFirstTurn(primeiro),
    });

    router.push("/duel/play");
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-zinc-400">Carregando catálogo de cartas...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-red-300">{error}</p>
      </div>
    );
  }

  return (
    <DeckSelectionLayout registry={registry} hoveredCode={hoveredCode}>
      <section className="rounded-2xl border border-amber-900/40 bg-zinc-950/80 p-6">
        <h2 className="text-lg font-semibold text-amber-300">Seu deck</h2>
        <DeckSelect escolha={meuDeck} onChange={meuDeck.setEscolha} onCardHover={setHoveredCode} />

        <div className="mt-4 flex items-center justify-between gap-4">
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              duelReady
                ? "bg-emerald-900/60 text-emerald-300"
                : "bg-amber-900/40 text-amber-200"
            }`}
          >
            {duelReady ? "Pronto para duelo" : "Incompleto (mín. 40 cartas)"}
          </span>
          {!duelReady && (
            <Link
              href="/"
              className="text-sm text-amber-400 underline-offset-2 hover:underline"
            >
              Voltar ao deck builder
            </Link>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-amber-900/40 bg-zinc-950/80 p-6">
        <h2 className="text-lg font-semibold text-amber-300">Oponente (bot)</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Escolha o deck do bot — do mesmo formato do seu (
          {formato === "tcg" ? "TCG" : "Goat"}).
        </p>

        {opcoes.length === 0 ? (
          <p className="mt-4 rounded-lg border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
            Ainda não há deck {formato === "tcg" ? "TCG" : "Goat"} para o bot.
            Monte e complete outro deck desse formato no construtor.
          </p>
        ) : (
          <select
            value={opponent?.id ?? ""}
            onChange={(event) => setOpponentId(event.target.value)}
            className="mt-4 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-600"
          >
            {[...new Set(opcoes.map((opcao) => opcao.grupo))].map((grupo) => {
              const doGrupo = opcoes.filter((opcao) => opcao.grupo === grupo);
              if (doGrupo.length === 0) return null;
              return (
                <optgroup key={grupo} label={grupo}>
                  {doGrupo.map((opcao) => (
                    <option key={opcao.id} value={opcao.id}>
                      {opcao.nome} ({opcao.cartas} cartas)
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        )}

        {opponent && (
          <DeckPreview deck={opponent.deck} registry={registry} onCardHover={setHoveredCode} />
        )}
      </section>

      <section className="rounded-2xl border border-amber-900/40 bg-zinc-950/80 p-6">
        <h2 className="text-lg font-semibold text-amber-300">Quem começa</h2>
        <div role="radiogroup" aria-label="Quem começa" className="mt-3 flex gap-2">
          {PRIMEIRO_TURNO.map((opcao) => (
            <button
              key={opcao.valor}
              type="button"
              role="radio"
              aria-checked={primeiro === opcao.valor}
              data-first-turn={opcao.valor}
              onClick={() => setPrimeiro(opcao.valor)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                primeiro === opcao.valor
                  ? "border-amber-500 bg-amber-600 text-black"
                  : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-amber-700"
              }`}
            >
              {opcao.rotulo}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          {PRIMEIRO_TURNO.find((opcao) => opcao.valor === primeiro)?.dica}
        </p>
      </section>

      <button
        type="button"
        disabled={!duelReady || !opponent}
        onClick={handleStart}
        className="rounded-xl bg-amber-600 px-6 py-3 text-sm font-semibold text-black transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Iniciar duelo vs bot
      </button>

      <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
        <button
          type="button"
          data-spectate
          disabled={!duelReady || !opponent}
          onClick={handleSpectate}
          title="O bot joga com o seu deck contra o deck escolhido — para ver como as cartas se usam"
          className="rounded-lg border border-zinc-700 px-4 py-2 text-zinc-200 transition hover:border-amber-700 disabled:opacity-40"
        >
          👁 Assistir bot × bot
        </button>
      </div>

      <p className="text-center text-xs text-zinc-600">
        Engine ocgcore-wasm · {formato === "tcg" ? "TCG (Master Rule 2020)" : "Goat Format"} · bot joga automaticamente
      </p>

      <Link
        href="/duel/online"
        className="text-center text-sm text-amber-400 underline-offset-2 hover:underline"
      >
        Duelar contra outra pessoa na sua rede →
      </Link>
    </DeckSelectionLayout>
  );
}
