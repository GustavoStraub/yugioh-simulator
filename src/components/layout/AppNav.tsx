"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { usePlayer } from "@/context/PlayerProvider";
import { LANGUAGE_OPTIONS } from "@/lib/i18n/language";

/** `short`: o rótulo no celular, onde cada letra disputa a largura. */
const NAV_ITEMS = [
  { href: "/", label: "Deck Builder", short: "Deck" },
  { href: "/duel", label: "vs Bot", short: "vs Bot" },
  { href: "/duel/puzzles", label: "Puzzles", short: "Puzzles" },
  { href: "/duel/online", label: "Online", short: "Online" },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    // No celular os itens não cabem lado a lado em `text-sm`: encolhem e, no
    // limite, rolam — nunca quebram linha. O PT/EN fica FORA da parte que
    // rola: dentro dela, o quarto item (Puzzles) já o empurrava para fora da
    // janela num celular de 390 px.
    <nav className="flex min-w-0 max-w-full items-center gap-1 whitespace-nowrap text-[12px] sm:gap-2 sm:text-sm">
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto sm:gap-2">
        {NAV_ITEMS.map(({ href, label, short }) => {
          // O item mais específico ganha: sem isto `/duel/online` acenderia
          // "vs Bot" junto, porque o prefixo bate nos dois.
          const active =
            href === "/"
              ? pathname === "/"
              : pathname.startsWith(href) &&
                !NAV_ITEMS.some(
                  (outro) =>
                    outro.href !== href &&
                    outro.href.startsWith(href) &&
                    pathname.startsWith(outro.href),
                );

          return (
            <Link
              key={href}
              href={href}
              className={`shrink-0 rounded-full px-2 py-1 transition sm:px-3 ${
                active
                  ? "bg-amber-600/20 text-amber-300"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              <span className="sm:hidden">{short}</span>
              <span className="max-sm:hidden">{label}</span>
            </Link>
          );
        })}
      </div>

      <LanguageToggle />
    </nav>
  );
}

/**
 * Idioma das CARTAS (a interface segue em português).
 *
 * Fica na navegação porque a troca é feita no meio do uso: procura-se a carta
 * pelo nome em inglês e lê-se o efeito em português, às vezes na mesma jogada.
 */
function LanguageToggle() {
  const { language, setLanguage } = usePlayer();

  return (
    <div
      className="ml-1 flex shrink-0 overflow-hidden rounded-full border border-zinc-800"
      role="group"
      aria-label="Idioma das cartas"
    >
      {LANGUAGE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setLanguage(option.value)}
          aria-pressed={language === option.value}
          className={`px-2 py-0.5 text-[11px] font-semibold transition ${
            language === option.value
              ? "bg-amber-600/20 text-amber-300"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
