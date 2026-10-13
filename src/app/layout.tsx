import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { SiteHeader } from "@/components/layout/SiteHeader";
import { PlayerProvider } from "@/context/PlayerProvider";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex h-full flex-col overflow-hidden bg-zinc-950 text-zinc-100">
        {/* A portaria vive DENTRO do provider e por fora das páginas: o nome
            precisa existir antes de qualquer tela tocar na biblioteca. */}
        <PlayerProvider>
          <SiteHeader />

          <main className="mx-auto flex min-h-0 w-full max-w-[1800px] flex-1 flex-col overflow-hidden">
            {children}
          </main>
        </PlayerProvider>
      </body>
    </html>
  );
}
