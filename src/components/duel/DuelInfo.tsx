"use client";

import { useEffect, useState } from "react";

import type { BoardPlayer } from "@/lib/duel/board-state";

/*
 * Os painéis do canto do Master Duel e o desgaste da mesa:
 *
 * - `DuelInfo` — o "i": o que cada um tem em campo e nas pilhas, num relance;
 * - `EffectsPanel` — o "!": o que está limitando as jogadas agora;
 * - `FieldCracks` — a mesa do MD vai rachando do lado de quem perde LP.
 */

/** ATK somado dos monstros de face para cima em posição de ataque. */
function ataqueEmCampo(player: BoardPlayer): number {
  return player.monsters.reduce(
    (total, card) =>
      card && !card.faceDown && !card.defense && card.attack !== null ? total + card.attack : total,
    0,
  );
}

function Linha({ icone, rotulo, valor }: { icone: string; rotulo: string; valor: number | string }) {
  return (
    <li className="md-info-row" title={rotulo}>
      <span aria-hidden className="md-info-icon">
        {icone}
      </span>
      <span className="md-info-label">{rotulo}</span>
      <span className="md-info-value">{valor}</span>
    </li>
  );
}

function Lado({ titulo, player, side }: { titulo: string; player: BoardPlayer; side: "me" | "foe" }) {
  return (
    <section className={`md-info-side md-info-${side}`}>
      <h4 className="md-info-title">{titulo}</h4>
      <ul>
        <Linha icone="⚔" rotulo="ATK em campo" valor={ataqueEmCampo(player)} />
        <Linha icone="✋" rotulo="Mão" valor={player.hand.length} />
        <Linha icone="▤" rotulo="Deck" valor={player.deckSize} />
        <Linha icone="☗" rotulo="Cemitério" valor={player.graveSize} />
        <Linha icone="⊘" rotulo="Banidas" valor={player.banishedSize} />
        <Linha icone="✦" rotulo="Extra Deck" valor={player.extraSize} />
      </ul>
    </section>
  );
}

/**
 * O "i" do Master Duel: quanto ATK cada um tem em pé e o tamanho de cada
 * pilha — a conta que se faz antes de atacar ("passa dos LP dele?").
 */
export function DuelInfo({
  you,
  foe,
  estreita,
  onClose,
}: {
  you: BoardPlayer;
  foe: BoardPlayer;
  estreita: boolean;
  onClose: () => void;
}) {
  return (
    <div
      data-duel-info-panel
      data-table-control
      className={`md-info-panel absolute z-[48] ${estreita ? "md-info-narrow" : ""}`}
      role="dialog"
      aria-label="Informações do duelo"
    >
      <header className="md-info-head">
        <span>Informações do duelo</span>
        <button type="button" onClick={onClose} aria-label="Fechar" className="md-info-close">
          ✕
        </button>
      </header>
      <div className="md-info-grid">
        <Lado titulo="Oponente" player={foe} side="foe" />
        <Lado titulo="Você" player={you} side="me" />
      </div>
    </div>
  );
}

/**
 * O "!" do Master Duel: as cartas e efeitos que limitam o que cada um pode
 * fazer agora ("não pode Invocar-Especial neste turno"). O núcleo manda esses
 * avisos por jogador (`PLAYER_HINT`); antes eles ficavam pendurados nas placas
 * de LP.
 */
export function EffectsPanel({
  mine,
  theirs,
  onClose,
}: {
  mine: string[];
  theirs: string[];
  onClose: () => void;
}) {
  const vazio = mine.length === 0 && theirs.length === 0;
  return (
    <div
      data-player-hints={mine.length + theirs.length}
      data-table-control
      className="md-info-panel md-effects-panel absolute z-[48]"
      role="dialog"
      aria-label="Efeitos que limitam as jogadas"
    >
      <header className="md-info-head">
        <span>Efeitos limitando jogadas</span>
        <button type="button" onClick={onClose} aria-label="Fechar" className="md-info-close">
          ✕
        </button>
      </header>
      {vazio ? (
        <p className="px-3 py-3 text-[12px] text-zinc-400">Nada limitando as jogadas agora.</p>
      ) : (
        <div className="space-y-2 p-2.5">
          {theirs.length > 0 && (
            <section>
              <h4 className="md-info-title md-info-foe">Oponente</h4>
              <ul className="space-y-1">
                {theirs.map((hint) => (
                  <li key={hint} className="md-effect-item md-effect-foe">
                    {hint}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {mine.length > 0 && (
            <section>
              <h4 className="md-info-title md-info-me">Você</h4>
              <ul className="space-y-1">
                {mine.map((hint) => (
                  <li key={hint} className="md-effect-item md-effect-me">
                    {hint}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/** Em que estágio de rachadura a mesa está para este LP (0 = inteira). */
export function crackStage(lp: number): 0 | 1 | 2 | 3 {
  if (lp <= 2000) return 3;
  if (lp <= 4000) return 2;
  if (lp <= 6000) return 1;
  return 0;
}

/*
 * As rachaduras, desenhadas uma vez: cada estágio acrescenta traços aos do
 * anterior. Coordenadas num quadro 100×50 (meia mesa), em `preserveAspectRatio
 * none` — esticam junto com a metade da mesa.
 */
const CRACKS: string[][] = [
  [],
  [
    "M8 46 L14 38 L13 31 L19 24 L18 18",
    "M14 38 L22 36 L27 39",
    "M88 6 L83 13 L85 19 L79 25",
  ],
  [
    "M44 49 L47 41 L45 34 L51 27 L50 20 L56 14",
    "M47 41 L55 40 L61 44 L67 42",
    "M51 27 L44 23 L38 25",
    "M93 44 L88 37 L90 31 L84 26",
  ],
  [
    "M2 22 L9 23 L15 19 L22 21 L28 16 L35 18",
    "M28 16 L30 9 L26 3",
    "M64 3 L66 10 L62 16 L68 22 L66 29 L72 35",
    "M66 29 L74 27 L80 30",
    "M72 35 L70 42 L76 48",
    "M18 18 L12 12 L14 6",
  ],
];

/**
 * A mesa do MD se quebrando: rachaduras na metade de quem está perdendo LP —
 * a 6000, 4000 e 2000. Quando passa de um estágio para o outro, o traço novo
 * "corre" (desenho animado do traço) e a metade dá um clarão.
 */
export function FieldCracks({ lp, side }: { lp: number; side: "me" | "foe" }) {
  const estagio = crackStage(lp);
  const [visto, setVisto] = useState(estagio);
  const [novo, setNovo] = useState<number | null>(null);
  if (visto !== estagio) {
    setVisto(estagio);
    setNovo(estagio > visto ? estagio : null);
  }
  useEffect(() => {
    if (novo === null) return;
    const timer = setTimeout(() => setNovo(null), 1400);
    return () => clearTimeout(timer);
  }, [novo]);

  if (estagio === 0) return null;
  const tracos = CRACKS.slice(1, estagio + 1).flatMap((lista, indice) =>
    lista.map((d) => ({ d, estagio: indice + 1 })),
  );
  return (
    <svg
      aria-hidden
      data-cracks={estagio}
      className={`md-cracks md-cracks-${side} ${novo !== null ? "md-cracks-fresh" : ""}`}
      viewBox="0 0 100 50"
      preserveAspectRatio="none"
    >
      {tracos.map(({ d, estagio: deQual }, index) => (
        <g key={index} className={deQual === novo ? "md-crack-new" : undefined}>
          <path d={d} className="md-crack-glow" pathLength={1} />
          <path d={d} className="md-crack-line" pathLength={1} />
        </g>
      ))}
    </svg>
  );
}
