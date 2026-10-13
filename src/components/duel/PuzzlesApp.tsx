"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { usePlayer } from "@/context/PlayerProvider";
import { useClientSnapshot } from "@/hooks/useClientSnapshot";
import { PUZZLES, type DuelPuzzle } from "@/lib/data/puzzles";
import { saveDuelSetup } from "@/lib/duel/duel-storage";
import { parseSolved, PUZZLES_SOLVED_KEY, readSolvedRaw } from "@/lib/duel/puzzle-progress";

/**
 * A lista dos duelos-problema ("vença neste turno").
 *
 * Cada um abre a mesa local já montada; o objetivo fica à vista durante o
 * duelo, com uma dica a um clique, e a solução só depois de errar.
 */
export function PuzzlesApp() {
  const router = useRouter();
  const { profile } = usePlayer();
  const resolvidos = useClientSnapshot<string[]>(PUZZLES_SOLVED_KEY, readSolvedRaw, parseSolved, []);
  const [dica, setDica] = useState<string | null>(null);

  function jogar(puzzle: DuelPuzzle) {
    saveDuelSetup({
      playerName: profile?.name || "Você",
      playerDeck: { main: puzzle.deck, extra: [], side: [] },
      opponentId: puzzle.id,
      opponentName: "Oponente",
      opponentDeck: { main: puzzle.opponentDeck, extra: [], side: [] },
      format: puzzle.format,
      puzzleId: puzzle.id,
    });
    router.push("/duel/play");
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 overflow-y-auto p-6">
      <header>
        <h2 className="text-lg font-semibold text-amber-300">Duelos-problema</h2>
        <p className="mt-1 text-sm text-zinc-400">
          A mesa vem montada; vença <strong className="text-zinc-200">neste turno</strong>. Cada problema
          ensina uma ideia — e o bot do outro lado responde de verdade.
        </p>
      </header>

      <ul className="flex flex-col gap-3">
        {PUZZLES.map((puzzle, index) => {
          const feito = resolvidos.includes(puzzle.id);
          return (
            <li
              key={puzzle.id}
              data-puzzle={puzzle.id}
              className="rounded-2xl border border-amber-900/40 bg-zinc-950/80 p-4"
            >
              <div className="flex items-start gap-3">
                <span className="font-mono text-sm text-zinc-500">{index + 1}.</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-zinc-100">
                    {puzzle.title}{" "}
                    {feito && (
                      <span data-puzzle-solved className="ml-1 text-xs font-bold text-emerald-400">
                        ✓ resolvido
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-sm text-zinc-400">{puzzle.goal}</p>
                  {dica === puzzle.id && <p className="mt-1 text-sm text-sky-200">💡 {puzzle.hint}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <button
                    type="button"
                    data-play-puzzle={puzzle.id}
                    onClick={() => jogar(puzzle)}
                    className="rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-semibold text-black hover:bg-amber-500"
                  >
                    Jogar
                  </button>
                  <button
                    type="button"
                    onClick={() => setDica((atual) => (atual === puzzle.id ? null : puzzle.id))}
                    className="text-xs text-sky-300 hover:text-sky-200"
                  >
                    {dica === puzzle.id ? "Esconder dica" : "Dica"}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <Link href="/duel" className="text-center text-sm text-amber-400 underline-offset-2 hover:underline">
        ← Duelo contra o bot
      </Link>
    </div>
  );
}
