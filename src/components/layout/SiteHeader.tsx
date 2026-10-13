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
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-amber-900/30 bg-zinc-950/95 px-2 py-1.5 sm:px-4">
        <Link
          href="/duel"
          className="shrink-0 whitespace-nowrap text-[13px] font-bold tracking-tight text-amber-400 transition hover:text-amber-300"
        >
          {/* No celular a barra da mesa divide 390 px entre o nome e quatro
              itens de navegação; "Goat" sozinho devolve a largura que faltava
              para o último item não ficar cortado. */}
          <span className="max-sm:hidden">Yu-Gi-Oh! </span>Goat
        </Link>
        <AppNav />
      </header>
    );
  }

  return (
    <header className="shrink-0 border-b border-amber-900/30 bg-zinc-950/95 px-4 py-4 backdrop-blur">
      {/* No celular o título e a navegação empilham: lado a lado, o título
          ficava com metade da largura e a navegação rolava com "Puzzles" e
          "Online" fora de vista. */}
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 max-sm:flex-col max-sm:items-start max-sm:gap-2">
        <div className="min-w-0 shrink">
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
