"use client";

import { OcgLocation } from "@n1xx1/ocgcore-wasm";

import { useCardText } from "@/hooks/useCardText";
import type { CardRegistry } from "@/lib/domain/card-registry";

/** O que o destaque mostra agora — vem de `useDuelFeedback`. */
export interface ChainSpotlightState {
  token: number;
  code: number;
  /** Quem ativou é quem está olhando a mesa? */
  mine: boolean;
  link: number;
  /** De onde a carta foi ativada (`OcgLocation`). */
  from: number;
  kind: "activate" | "negated";
  /** Só no `negated`: a ativação inteira ou só o efeito. */
  what?: "activation" | "effect";
  duration: number;
}

const ORIGEM: Partial<Record<number, string>> = {
  [OcgLocation.HAND]: "da mão",
  [OcgLocation.GRAVE]: "do Cemitério",
  [OcgLocation.REMOVED]: "das banidas",
  [OcgLocation.DECK]: "do Deck",
  [OcgLocation.EXTRA]: "do Extra Deck",
};

/**
 * A carta em destaque no centro da mesa quando algo é ativado — como no
 * Master Duel.
 *
 * Antes, uma ativação era uma linha no histórico e uma carta trocando de zona:
 * a Ash Blossom do oponente ia da mão para o Cemitério e a busca do jogador
 * simplesmente não acontecia, sem nada na tela dizendo por quê. Agora cada elo
 * aparece grande, com quem ativou, de onde e o número do elo; e quando um elo
 * é negado a mesma carta volta com o carimbo NEGADO.
 *
 * Não captura o mouse: é informação, e o prompt que vier junto (responder à
 * corrente) continua clicável por baixo.
 */
export function ChainSpotlight({
  spotlight,
  registry,
}: {
  spotlight: ChainSpotlightState | null;
  registry: CardRegistry | null;
}) {
  const texto = useCardText();
  if (!spotlight) return null;

  const def = registry?.get(spotlight.code);
  const nome = def ? texto.name(def) : "Carta";
  const imagem = def?.images[0]?.image_url ?? `/card-images/full/${spotlight.code}.jpg`;
  const origem = ORIGEM[spotlight.from];
  const negada = spotlight.kind === "negated";
  const quem = spotlight.mine ? "Você" : "Oponente";

  return (
    <div
      key={spotlight.token}
      data-chain-spotlight={spotlight.kind}
      data-chain-link={spotlight.link}
      // A mesa escurece um pouco atrás da carta, como no Master Duel: o olho
      // vai para o elo, e o campo continua visível em volta.
      className="tf-spotlight-backdrop pointer-events-none absolute inset-0 z-40 flex items-center justify-center"
      style={{ animationDuration: `${spotlight.duration}ms` }}
    >
      <div
        className="tf-spotlight flex flex-col items-center gap-2"
        style={{ animationDuration: `${spotlight.duration}ms` }}
      >
        {/* Na ativação a cor diz de quem é o elo (dourado = seu, vermelho =
            do oponente — a mesma do número do elo); na negação o rótulo é
            sempre vermelho, porque o que importa ali é o "negado", e o
            número do elo continua dizendo de quem era. */}
        <div
          className={`rounded-full px-3 py-1 text-[12px] font-extrabold uppercase tracking-[0.2em] shadow-lg shadow-black/60 ${
            negada
              ? "bg-red-700 text-white ring-2 ring-red-400"
              : spotlight.mine
                ? "bg-[color:var(--tf-gold)] text-black"
                : "bg-red-600 text-white"
          }`}
        >
          {negada
            ? spotlight.what === "activation"
              ? "Ativação negada"
              : "Efeito negado"
            : `${quem} ativou`}
        </div>

        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imagem}
            alt={nome}
            className={`h-[min(42vh,320px)] w-auto rounded-md shadow-2xl ${
              spotlight.mine ? "tf-spotlight-glow-mine" : "tf-spotlight-glow-foe"
            } ${negada ? "grayscale" : ""}`}
          />
          {/* O número do elo, no canto da carta — o mesmo que aparece na
              pilha da corrente e no slot da carta. */}
          <span
            className={`absolute -left-3 -top-3 flex h-10 w-10 items-center justify-center rounded-full border-2 border-black/70 text-[18px] font-black shadow-lg ${
              spotlight.mine ? "bg-[color:var(--tf-gold)] text-black" : "bg-red-600 text-white"
            }`}
          >
            {spotlight.link}
          </span>
          {negada && (
            <span className="tf-negated-stamp absolute inset-x-[-12%] top-1/2 -translate-y-1/2 -rotate-12 border-4 border-red-500 bg-black/70 py-2 text-center text-[28px] font-black uppercase tracking-[0.15em] text-red-400">
              Negado
            </span>
          )}
        </div>

        <div className="max-w-[320px] rounded-md bg-black/80 px-3 py-1.5 text-center shadow-lg shadow-black/60">
          <p className="text-[15px] font-bold leading-tight text-[color:var(--tf-gold-bright)]">{nome}</p>
          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
            Elo {spotlight.link}
            {!negada && origem ? ` · ${origem}` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
