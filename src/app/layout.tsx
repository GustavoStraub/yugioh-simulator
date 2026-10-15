import type { Metadata } from "next";
import { Exo_2, Geist, Geist_Mono, Oxanium } from "next/font/google";

import { SiteHeader } from "@/components/layout/SiteHeader";
import { PlayerProvider } from "@/context/PlayerProvider";

import "./globals.css";
// Depois do globals.css, de propósito: a mesa do Master Duel redefine os
// tokens do tema dentro de `.md-duel`, e com a mesma especificidade vence
// quem vem depois. Importado aqui (e não no componente) para a ordem ser
// sempre esta — a recomendação do Next para CSS global.
import "./md-duel.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/*
 * As duas letras da mesa do Master Duel. O jogo usa fontes próprias, que não
 * dá para copiar; estas são as mais próximas entre as livres: a Exo 2 itálica
 * pesada das faixas ("BATTLE PHASE", "VICTORY") e do botão de fase, e a
 * Oxanium, de dígitos quadrados com cantos cortados, para o LP e os números
 * grandes. Só baixam quando a mesa as usa (`variable` expõe a família; o
 * arquivo vem na primeira regra que a pede).
 */
const mdDisplay = Exo_2({
  variable: "--font-md-display",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const mdDigits = Oxanium({
  variable: "--font-md-digits",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Yu-Gi-Oh! Goat — Deck Builder & Duelo",
  description:
    "Construtor de decks e duelos — Goat Format e TCG — com cartas em português.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} ${mdDisplay.variable} ${mdDigits.variable} h-full antialiased`}
    >
      <body className="flex h-full flex-col overflow-x-hidden overflow-y-auto bg-zinc-950 text-zinc-100">
        {/* A portaria vive DENTRO do provider e por fora das páginas: o nome
            precisa existir antes de qualquer tela tocar na biblioteca. */}
        <PlayerProvider>
          <SiteHeader />

          <main className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col overflow-visible lg:min-h-0">
            {children}
          </main>
        </PlayerProvider>
      </body>
    </html>
  );
}
