"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCardRegistry } from "@/context/CardRegistryProvider";
import { usePlayer } from "@/context/PlayerProvider";
import { useDeckEscolha } from "@/hooks/useDeckEscolha";
import { DeckSelect } from "@/components/duel/DeckSelect";
import { presetToDuelPayload } from "@/lib/domain/preset-decks";
import { PRESET_DECKS } from "@/lib/data/preset-decks-catalog";
import { saveDuelSetup } from "@/lib/duel/duel-storage";

export function DuelLobby() {
  const router = useRouter();
  const { isLoading, error } = useCardRegistry();
  const { profile } = usePlayer();
  const [opponentId, setOpponentId] = useState(PRESET_DECKS[1]?.id ?? "");
  // A biblioteca inteira do jogador, não só o deck aberto no construtor —
  // quem montou cinco decks escolhe qual leva para a mesa.
  const meuDeck = useDeckEscolha();
  const duelReady = meuDeck.pronto;
  const opponent = PRESET_DECKS.find((preset) => preset.id === opponentId);

  function handleStart() {
    if (!duelReady || !opponent) return;

    saveDuelSetup({
      // O nome de quem joga, não o do deck: é ele que aparece na barra de LP.
      playerName: profile?.name || meuDeck.deckName,
      playerDeck: meuDeck.deck,
      opponentId: opponent.id,
      opponentName: opponent.namePt,
      opponentDeck: presetToDuelPayload(opponent),
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
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 overflow-y-auto p-6">
      <section className="rounded-2xl border border-amber-900/40 bg-zinc-950/80 p-6">
        <h2 className="text-lg font-semibold text-amber-300">Seu deck</h2>
        <DeckSelect escolha={meuDeck} onChange={meuDeck.setEscolha} />

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
          Escolha um deck oficial para o bot usar.
        </p>

        <select
          value={opponentId}
          onChange={(event) => setOpponentId(event.target.value)}
          className="mt-4 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-600"
        >
          {PRESET_DECKS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.namePt} ({preset.main.length} cartas)
            </option>
          ))}
        </select>
      </section>

      <button
        type="button"
        disabled={!duelReady || !opponent}
        onClick={handleStart}
        className="rounded-xl bg-amber-600 px-6 py-3 text-sm font-semibold text-black transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Iniciar duelo vs bot
      </button>

      <p className="text-center text-xs text-zinc-600">
        Engine ocgcore-wasm · Goat Format · bot joga automaticamente
      </p>

      <Link
        href="/duel/online"
        className="text-center text-sm text-amber-400 underline-offset-2 hover:underline"
      >
        Duelar contra outra pessoa na sua rede →
      </Link>
    </div>
  );
}
