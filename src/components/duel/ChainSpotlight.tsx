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
  /** O efeito ativado, como o core o descreve (ver `DuelChainLink`). */
  description?: string | null;
  kind: "activate" | "negated";
  /** Só no `negated`: a ativação inteira ou só o efeito. */
  what?: "activation" | "effect";
  duration: number;
}

export type ChainEffectNoticeState = Pick<
  ChainSpotlightState,
  "token" | "code" | "mine" | "link" | "description" | "duration"
>;

export const ORIGEM: Partial<Record<number, string>> = {
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
 * O fundo não captura o mouse: é informação, e o prompt que vier junto
 * (responder à corrente) continua clicável por baixo. Só a carta captura —
 * clicar nela pula o destaque.
 */
export function ChainSpotlight({
  spotlight,
  registry,
  onSkip,
  names = { mine: "Você", foe: "Oponente" },
}: {
  spotlight: ChainSpotlightState | null;
  registry: CardRegistry | null;
  /** Quem ativou, pelo nome — quem só assiste bot × bot não é "Você". */
  names?: { mine: string; foe: string };
  /**
   * Clique na carta: pula o destaque (e a pausa da sessão, no duelo local) —
   * o ○ do Tag Force. Quem já leu o elo não precisa esperar o resto.
   */
  onSkip?: () => void;
}) {
  const texto = useCardText();
  if (!spotlight) return null;

  const def = registry?.get(spotlight.code);
  const nome = def ? texto.name(def) : "Carta";
  const imagem = def?.images[0]?.image_url ?? `/card-images/full/${spotlight.code}.jpg`;
  const origem = ORIGEM[spotlight.from];
  const negada = spotlight.kind === "negated";
  const quem = spotlight.mine ? names.mine : names.foe;

  return (
    <div
      key={spotlight.token}
      data-chain-spotlight={spotlight.kind}
      data-chain-link={spotlight.link}
      // A mesa escurece um pouco atrás da carta, como no Master Duel: o olho
      // vai para o elo, e o campo continua visível em volta.
      className={`md-spot ${spotlight.mine ? "md-spot-me" : "md-spot-foe"} ${negada ? "md-spot-negated" : ""} tf-spotlight-backdrop pointer-events-none absolute inset-0 z-40`}
      style={{ animationDuration: `${spotlight.duration}ms`, ["--md-spot-ms" as string]: `${spotlight.duration}ms` }}
    >
      <div
        className={`md-spot-stage ${onSkip ? "pointer-events-auto cursor-pointer" : ""}`}
        onClick={onSkip}
        title={onSkip ? "Clique para pular" : undefined}
      >
        {/* Na ativação a cor diz de quem é o elo (azul seu, vermelho do
            oponente — a mesma do número do elo); na negação o rótulo é
            vermelho, e o número do elo continua dizendo de quem era. */}
        <div className={`md-spot-label ${negada ? "md-spot-label-negated" : ""}`}>
          {negada
            ? spotlight.what === "activation"
              ? "Ativação negada"
              : "Efeito negado"
            : `${quem} ativou${origem ? ` ${origem}` : ""}`}
        </div>

        <div className="md-spot-card-wrap">
          {/* A corrente do MD: o elo novo pendurado no anterior. */}
          {spotlight.link > 1 && <span aria-hidden className="md-spot-chain" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imagem} alt={nome} className={`md-spot-card ${negada ? "grayscale" : ""}`} draggable={false} />
          {/* O número do elo, enorme e vazado, como os do MD. */}
          <span aria-hidden className="md-spot-number">
            {spotlight.link}
          </span>
          {negada && (
            <>
              <span aria-hidden className="md-spot-forbid" />
              <span className="tf-negated-stamp md-spot-stamp">NEGATED</span>
            </>
          )}
        </div>

        <p className="md-spot-name">
          {nome}
          <span className="md-spot-link">Elo {spotlight.link}</span>
        </p>
      </div>
    </div>
  );
}

/** A leitura do canto permanece após a animação central, sem capturar cliques. */
export function ChainEffectNotice({
  notice,
  registry,
}: {
  notice: ChainEffectNoticeState | null;
  registry: CardRegistry | null;
}) {
  const texto = useCardText();
  if (!notice) return null;
  const def = registry?.get(notice.code);
  const nome = def ? texto.name(def) : "Carta";
  const efeito = notice.description;
  const textoDaCarta = def ? texto.desc(def) : null;
  if (!efeito && !textoDaCarta) return null;

  return (
    <div
      key={notice.token}
      data-effect-notice={notice.code}
      data-effect-token={notice.token}
      data-effect-link={notice.link}
      className={`md-spot ${notice.mine ? "md-spot-me" : "md-spot-foe"} pointer-events-none absolute inset-0 z-40`}
      style={{ ["--md-spot-ms" as string]: `${notice.duration}ms` }}
    >
      <div className="md-spot-effect">
        <p className="md-spot-effect-name">{nome}</p>
        {efeito && (
          <p data-spotlight-effect className="md-spot-effect-what">
            {efeito}
          </p>
        )}
        {textoDaCarta && (
          <p data-spotlight-text className="md-spot-effect-text">
            {textoDaCarta}
          </p>
        )}
      </div>
    </div>
  );
}
