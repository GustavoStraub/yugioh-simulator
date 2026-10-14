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
    // A corrente do Master Duel: os elos empilhados, o último (o primeiro a
    // resolver) em cima, cada um com o número grande e a carta, ligados por
    // uma corrente desenhada. O que resolve acende; o negado ganha o
    // "proibido".
    <section
      data-chain-stack={mostradas.length}
      className={`md-chain-stack ${terminada ? "md-chain-stack-done" : ""}`}
    >
      <h3 className="md-chain-stack-title">
        <span>Chain</span>
        <span className="md-chain-stack-count">
          {terminada ? "terminou" : `${mostradas.length} elo${mostradas.length > 1 ? "s" : ""}`}
        </span>
      </h3>
      <ol className="md-chain-list">
        {[...mostradas].reverse().map((link, index) => {
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
              className={`md-chain-row ${meu ? "md-chain-row-me" : "md-chain-row-foe"} md-chain-row-${link.state}`}
            >
              {index > 0 && <span aria-hidden className="md-chain-links" />}
              <span aria-hidden className="md-chain-digit">
                {link.link}
              </span>
              <span className="md-chain-thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={def?.images[0]?.image_url_small ?? `/card-images/small/${link.code}.jpg`}
                  alt=""
                  className={negado ? "grayscale" : undefined}
                />
                {negado && <span aria-hidden className="md-chain-forbid" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`md-chain-name ${negado ? "line-through decoration-red-400/80" : ""}`}>{nome}</p>
                <p className="md-chain-meta">
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
