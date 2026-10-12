"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { AppNav } from "@/components/layout/AppNav";

/**
 * Cabeçalho do site, que encolhe na mesa de duelo.
 *
 * Fora do duelo ele apresenta o projeto. Dentro, é espaço morto: aquelas ~80px
 * de título saem da altura do tabuleiro, e é a altura que decide o tamanho das
 * cartas (elas têm proporção fixa e crescem a partir da altura da fileira).
 * Na mesa, então, sobra só uma barra fina com a navegação — que ainda precisa
 * existir para dar como sair do duelo.
 */
export function SiteHeader() {
  const pathname = usePathname();
  // A sala online usa a mesa inteira assim que o duelo começa; encolher o
  // cabeçalho já ao entrar evita o salto de layout no meio da partida.
  const naMesa = pathname === "/duel/play" || /^\/duel\/online\/./.test(pathname);

  if (naMesa) {
    return (
      <header className="flex shrink-0 items-center justify-between border-b border-amber-900/30 bg-zinc-950/95 px-4 py-1.5">
        <Link
          href="/duel"
          className="text-[13px] font-bold tracking-tight text-amber-400 transition hover:text-amber-300"
        >
          Yu-Gi-Oh! Goat
        </Link>
        <AppNav />
      </header>
    );
  }

  return (
    <header className="shrink-0 border-b border-amber-900/30 bg-zinc-950/95 px-4 py-4 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-amber-400">
            Yu-Gi-Oh! Goat
          </h1>
          <p className="text-sm text-zinc-500">
            Deck builder · duelo vs bot e online · Goat e TCG
          </p>
        </div>
        <AppNav />
      </div>
    </header>
  );
}
