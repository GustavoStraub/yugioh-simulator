"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { usePlayer } from "@/context/PlayerProvider";
import { LANGUAGE_OPTIONS } from "@/lib/i18n/language";

const NAV_ITEMS = [
  { href: "/", label: "Deck Builder" },
  { href: "/duel", label: "vs Bot" },
  { href: "/duel/online", label: "Online" },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-2 text-sm">
      {NAV_ITEMS.map(({ href, label }) => {
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
            className={`rounded-full px-3 py-1 transition ${
              active
                ? "bg-amber-600/20 text-amber-300"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            }`}
          >
            {label}
          </Link>
        );
      })}

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
      className="ml-1 flex overflow-hidden rounded-full border border-zinc-800"
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
