"use client";

import { useState } from "react";

import { useCardText } from "@/hooks/useCardText";
import type { SummonCutInState } from "@/hooks/useDuelFeedback";
import type { CardRegistry } from "@/lib/domain/card-registry";

/** O rótulo pequeno de cada invocação, em cima das estrelas. */
const KIND_LABEL: Record<SummonCutInState["kind"], string> = {
  fusion: "FUSION SUMMON",
  synchro: "SYNCHRO SUMMON",
  xyz: "XYZ SUMMON",
  link: "LINK SUMMON",
  ritual: "RITUAL SUMMON",
  tribute: "TRIBUTE SUMMON",
};

/**
 * O corte de invocação do Master Duel: a tela escurece, a arte do monstro
 * entra grande com os raios de luz na cor do atributo dele, e a faixa de
 * baixo traz as estrelas (ou o Rank, ou o LINK), o nome em itálico e o
 * ATK/DEF. Só nas invocações do Extra Deck, de Ritual e por Tributo (a sessão
 * decide — `cutInFor`) e só enquanto ligado na engrenagem.
 *
 * Um clique pula (e encerra a pausa da sessão, no duelo local).
 */
export function SummonCutIn({
  cutIn,
  registry,
  onSkip,
}: {
  cutIn: SummonCutInState | null;
  registry: CardRegistry | null;
  onSkip: () => void;
}) {
  if (!cutIn) return null;
  // Um corte novo é um componente novo: o "a arte não veio" de um não vaza
  // para o próximo.
  return <CutInView key={cutIn.token} cutIn={cutIn} registry={registry} onSkip={onSkip} />;
}

function CutInView({
  cutIn,
  registry,
  onSkip,
}: {
  cutIn: SummonCutInState;
  registry: CardRegistry | null;
  onSkip: () => void;
}) {
  const texto = useCardText();
  // A arte recortada vem da YGOPRODeck na primeira vez que alguém a pede (e
  // pode faltar); sem ela, a carta inteira ocupa o lugar.
  const [semArte, setSemArte] = useState(false);
  const def = registry?.get(cutIn.code);
  const arte = def?.images[0]?.image_url_cropped ?? `/card-images/cropped/${cutIn.code}.jpg`;
  const carta = def?.images[0]?.image_url ?? `/card-images/full/${cutIn.code}.jpg`;
  const nome = def ? texto.name(def) : "";
  const atributo = (def?.attribute ?? "").toLowerCase() || "neutral";
  const xyz = cutIn.kind === "xyz";
  const link = cutIn.kind === "link";
  const nivel = def?.level ?? 0;

  return (
    <div
      data-summon-cutin={cutIn.kind}
      data-summon-code={cutIn.code}
      role="presentation"
      onClick={onSkip}
      title="Clique para pular"
      className={`md-cutin md-cutin-${atributo} md-cutin-${cutIn.kind} ${cutIn.mine ? "md-cutin-me" : "md-cutin-foe"} ${
        semArte ? "md-cutin-noart" : ""
      }`}
      style={{ ["--md-cutin-ms" as string]: `${cutIn.duration}ms` }}
    >
      <div className="md-cutin-bg" />
      <div className="md-cutin-rays" />
      <div className="md-cutin-sparks" />
      <div className="md-cutin-art-wrap">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={arte} alt="" className="md-cutin-art" draggable={false} onError={() => setSemArte(true)} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={carta} alt={nome} className="md-cutin-card" draggable={false} />
      </div>
      <div className="md-cutin-band">
        <p className="md-cutin-kind">{KIND_LABEL[cutIn.kind]}</p>
        {link ? (
          <p className="md-cutin-level md-cutin-level-text">LINK-{def?.linkval ?? "?"}</p>
        ) : nivel > 0 ? (
          <p className={`md-cutin-level ${xyz ? "md-cutin-rank" : ""}`} aria-label={xyz ? `Rank ${nivel}` : `Nível ${nivel}`}>
            {Array.from({ length: Math.min(nivel, 13) }, (_, i) => (
              <span key={i} className="md-cutin-star" style={{ animationDelay: `${120 + i * 40}ms` }} />
            ))}
          </p>
        ) : null}
        <p className="md-cutin-name">{nome}</p>
        <p className="md-cutin-stats">
          ATK {def?.atk ?? "?"}
          {!link && <span className="ml-6">DEF {def?.def ?? "?"}</span>}
        </p>
      </div>
    </div>
  );
}
