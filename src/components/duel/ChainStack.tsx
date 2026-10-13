"use client";

import { useEffect, useState } from "react";

import { OcgLocation } from "@n1xx1/ocgcore-wasm";

import { useCardText } from "@/hooks/useCardText";
import type { CardRegistry } from "@/lib/domain/card-registry";
import type { DuelChainLink } from "@/lib/duel/duel-session";

/** Quanto a pilha fica à vista depois que a corrente termina. */
const LINGER_MS = 1600;

const ORIGEM: Partial<Record<number, string>> = {
  [OcgLocation.HAND]: "da mão",
  [OcgLocation.GRAVE]: "do Cemitério",
  [OcgLocation.REMOVED]: "das banidas",
  [OcgLocation.DECK]: "do Deck",
  [OcgLocation.EXTRA]: "do Extra Deck",
};

const ESTADO: Record<DuelChainLink["state"], { label: string; className: string }> = {
  pending: { label: "na corrente", className: "text-zinc-400" },
  resolving: { label: "resolvendo…", className: "text-[color:var(--tf-gold-bright)]" },
  resolved: { label: "resolvido ✓", className: "text-emerald-300" },
  negated: { label: "ativação negada", className: "text-red-300 font-bold" },
  disabled: { label: "efeito negado", className: "text-red-300 font-bold" },
};

/**
 * A corrente inteira, do último elo (em cima — o primeiro a resolver) ao
 * primeiro.
 *
 * Mora no trilho da esquerda, acima da leitura da carta: durante uma corrente
 * é o que o jogador quer ler, e lá ela não cobre o campo. Cada elo diz quem
 * ativou, de onde e em que pé está — na corrente, resolvendo, resolvido, ou
 * NEGADO. Fica uns instantes depois do fim, para o desfecho ser lido.
 */
export function ChainStack({
  links,
  me,
  registry,
}: {
  links: DuelChainLink[];
  me: number;
  registry: CardRegistry | null;
}) {
  const texto = useCardText();
  // A última corrente não vazia, para a pilha não sumir no mesmo instante em
  // que o desfecho aparece. Atualizada durante o render (padrão do React para
  // estado derivado de props), e apagada por um timer depois do fim.
  const [ultima, setUltima] = useState<DuelChainLink[]>(links);
  const [vista, setVista] = useState(links.length > 0);
  if (links.length > 0 && (links !== ultima || !vista)) {
    setUltima(links);
    setVista(true);
  }
  useEffect(() => {
    if (links.length > 0) return;
    const timer = setTimeout(() => setVista(false), LINGER_MS);
    return () => clearTimeout(timer);
  }, [links.length]);

  const mostradas = links.length > 0 ? links : ultima;
  if (!vista || mostradas.length === 0) return null;
  const terminada = links.length === 0;

  return (
    <section
      data-chain-stack={mostradas.length}
      className={`mb-2 shrink-0 rounded-lg border border-[color:var(--tf-slot-border)] bg-black/40 p-2 transition-opacity duration-500 ${
        terminada ? "opacity-60" : "opacity-100"
      }`}
    >
      <h3 className="mb-1.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--tf-gold)]">
        <span>⛓ Corrente</span>
        <span className="text-zinc-400">
          {terminada ? "terminou" : `${mostradas.length} elo${mostradas.length > 1 ? "s" : ""}`}
        </span>
      </h3>
      <ol className="flex flex-col gap-1">
        {[...mostradas].reverse().map((link) => {
          const def = registry?.get(link.code);
          const nome = def ? texto.name(def) : "Carta";
          const meu = link.player === me;
          const estado = ESTADO[link.state];
          const negado = link.state === "negated" || link.state === "disabled";
          const origem = ORIGEM[link.from];
          return (
            <li
              key={link.link}
              data-chain-row={link.link}
              data-chain-state={link.state}
              className={`flex items-center gap-2 rounded-md px-1.5 py-1 ${
                link.state === "resolving"
                  ? "bg-[color:var(--tf-gold)]/15 ring-1 ring-[color:var(--tf-gold)]"
                  : negado
                    ? "bg-red-950/40"
                    : "bg-white/[0.03]"
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-black ${
                  meu ? "md-chain-mine" : "md-chain-foe"
                }`}
              >
                {link.link}
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={def?.images[0]?.image_url_small ?? `/card-images/small/${link.code}.jpg`}
                alt=""
                className={`h-10 w-auto shrink-0 rounded-[2px] ${negado ? "grayscale" : ""}`}
              />
              <div className="min-w-0 flex-1">
                <p className={`truncate text-[12px] font-semibold text-zinc-100 ${negado ? "line-through decoration-red-400/80" : ""}`}>
                  {nome}
                </p>
                <p className="truncate text-[10px] text-zinc-400">
                  {meu ? "Você" : "Oponente"}
                  {origem ? ` · ${origem}` : ""}
                  {" · "}
                  <span className={estado.className}>{estado.label}</span>
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
