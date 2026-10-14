"use client";

import { useEffect, useRef, useState } from "react";

import { OcgPhase, type OcgResponse } from "@n1xx1/ocgcore-wasm";

import { prefersReducedMotion } from "@/hooks/useDuelFeedback";
import { playSfx } from "@/lib/audio/sfx";
import type { ChainResponseMode } from "@/lib/duel/chain-mode";
import type { GlobalAction } from "@/lib/duel/duel-actions";
import { CHAIN_MODE_HINT, CHAIN_MODE_LABEL } from "@/lib/duel/duel-prefs";
import { mdPhaseShort, phaseLabel } from "@/lib/duel/phase-labels";
import { nextChainMode } from "@/components/duel/DuelSettings";

/*
 * O HUD da mesa no desenho do Master Duel: as placas de LP nos cantos, o
 * botão redondo de fase à direita e a fileira de botões redondos no canto de
 * baixo à direita (confirmação de ativação, "i", "!" e o registro).
 *
 * Mora fora do `DuelBoard` porque não decide nada do duelo — só mostra e
 * repassa o clique. A regra de quem pode o quê continua no tabuleiro.
 */

/**
 * O número de LP correndo até o valor novo, como no Master Duel: o dano se lê
 * no contador descendo, e não num salto de um quadro para o outro. Com
 * "menos movimento" ligado, salta direto.
 */
export function useContagem(alvo: number, duracao = 650): number {
  const [mostrado, setMostrado] = useState(alvo);
  const deRef = useRef(alvo);
  useEffect(() => {
    const de = deRef.current;
    if (de === alvo) return;
    // Menos movimento: um quadro só, já no valor final.
    const total = prefersReducedMotion() ? 0 : duracao;
    const inicio = performance.now();
    let quadro = 0;
    const passo = (agora: number) => {
      const t = total === 0 ? 1 : Math.min(1, (agora - inicio) / total);
      // Começa rápido e freia no fim — o último dígito "assenta".
      const suave = 1 - Math.pow(1 - t, 3);
      const valor = Math.round(de + (alvo - de) * suave);
      deRef.current = valor;
      setMostrado(valor);
      if (t < 1) quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [alvo, duracao]);
  return mostrado;
}

/** LP a partir do qual o número fica vermelho — o aviso do MD de "está perto". */
export const LP_LOW = 1000;

/**
 * Placa de LP do Master Duel: o avatar na ponta, o nome numa faixa escura e o
 * "LP 8000" grande, de dígitos quadrados, correndo até o valor novo.
 *
 * A sua mora embaixo à esquerda (avatar redondo), a do oponente em cima à
 * direita (avatar sextavado, do lado de fora) — como no jogo. Sem barra de
 * vida: o MD não tem, e o número correndo já conta o dano.
 */
export function LifePlate({
  name,
  lp,
  side,
  active,
  acting = false,
  role,
}: {
  name: string;
  lp: number;
  /** Lado da mesa: `me` é a placa de baixo (quem olha), `foe` a de cima. */
  side: "me" | "foe";
  /** É o turno deste jogador — o fio da placa acende na cor dele. */
  active: boolean;
  /**
   * O jogo está esperando ESTE jogador decidir — a luz de "quem age" do
   * Master Duel: acende do lado de quem tem a vez de responder, que nem
   * sempre é o dono do turno (a janela de resposta na corrente).
   */
  acting?: boolean;
  /** "Você", "Oponente", "Bot" — só para leitores de tela e a dica. */
  role: string;
}) {
  const mostrado = useContagem(lp);
  const baixo = lp <= LP_LOW;

  // Um "bump" curto sempre que o valor muda, para o dano não passar batido.
  const [bump, setBump] = useState(false);
  const [shownLp, setShownLp] = useState(lp);
  if (shownLp !== lp) {
    setShownLp(lp);
    setBump(true);
    setTimeout(() => setBump(false), 360);
  }

  return (
    <div
      data-lp-bar
      data-lp-side={side}
      title={`${name} — ${role}`}
      className={`md-plate md-plate-${side} ${active ? "md-plate-active" : ""}`}
    >
      <span aria-hidden className="md-plate-avatar">
        <span className="md-plate-avatar-face">{name.trim().charAt(0).toUpperCase() || "?"}</span>
        {acting && <span data-acting className="md-acting-light" title="Decidindo agora" />}
      </span>
      <div className="md-plate-body">
        <p className="md-plate-name">{name}</p>
        <p className="md-plate-lp">
          <span className="md-plate-lp-label">LP</span>
          <span
            data-lp-value={lp}
            className={`md-plate-lp-value ${baixo ? "md-lp-low" : ""} ${bump ? "tf-lp-bump" : ""}`}
          >
            {mostrado}
          </span>
        </p>
      </div>
    </div>
  );
}

/** As transições de fase que o core oferece como comando livre. */
const PHASE_OPTIONS: { short: "BP" | "M2" | "EP"; label: string; test: RegExp }[] = [
  { short: "BP", label: "Battle Phase", test: /battle phase/i },
  { short: "M2", label: "Main Phase 2", test: /main phase 2/i },
  { short: "EP", label: "End Phase", test: /encerrar turno/i },
];

/**
 * O botão de fase do Master Duel: um disco à direita da mesa com "Turn N" e a
 * fase atual. Azul com aro dourado no seu turno; sextavado vermelho no do
 * oponente. Clicado no seu turno, abre ao lado as fases para onde se pode ir
 * (Battle, Main 2, End) — só as que o core oferece agora.
 *
 * `data-phase` nas opções é o que os testes e os atalhos procuram.
 */
export function PhaseButton({
  phase,
  turn,
  mine,
  actions,
  disabled = false,
  onRespond,
}: {
  phase: number | null;
  /** Turnos já iniciados. 0 = o duelo ainda não começou. */
  turn: number;
  /** O turno é de quem olha a mesa? */
  mine: boolean;
  actions: GlobalAction[];
  disabled?: boolean;
  onRespond: (response: OcgResponse) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const opcoes = PHASE_OPTIONS.map((opcao) => ({
    ...opcao,
    action: actions.find((action) => opcao.test.test(action.label)) ?? null,
  })).filter((opcao) => opcao.action !== null);
  const pode = !disabled && opcoes.length > 0;
  // O menu só existe enquanto há para onde ir. Ajustado durante o render (o
  // padrão do React para estado derivado): sem isto ele ficava aberto, vazio,
  // depois que a fase mudou por outro caminho.
  if (aberto && !pode) setAberto(false);

  // Esc fecha o menu antes de qualquer outra coisa da mesa.
  useEffect(() => {
    if (!aberto) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      setAberto(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [aberto]);

  const nome = phase !== null ? mdPhaseShort(phase) : "—";
  const batalha =
    phase !== null &&
    (phase &
      (OcgPhase.BATTLE_START | OcgPhase.BATTLE_STEP | OcgPhase.DAMAGE | OcgPhase.DAMAGE_CAL | OcgPhase.BATTLE)) !==
      0;

  return (
    <div className="md-phase" data-phase-track data-turn-owner={mine ? "me" : "foe"}>
      {aberto && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setAberto(false)} />
          <div role="menu" aria-label="Avançar de fase" className="md-phase-menu z-[61]">
            {opcoes.map((opcao) => (
              <button
                key={opcao.short}
                type="button"
                role="menuitem"
                data-phase={opcao.short}
                title={opcao.action?.label}
                onClick={() => {
                  playSfx("click");
                  setAberto(false);
                  if (opcao.action) onRespond(opcao.action.response);
                }}
                className={`md-phase-option md-phase-option-${opcao.short.toLowerCase()}`}
              >
                <span aria-hidden className="md-phase-option-icon" />
                {opcao.label}
              </button>
            ))}
          </div>
        </>
      )}
      <button
        type="button"
        data-phase-button
        // O botão só ABRE o menu — quem joga são as opções. Por isso é
        // controle da mesa (os laços de clique dos testes o pulam) e diz, em
        // `data-phase-options`, para onde dá para ir agora ("BP EP").
        data-table-control
        data-phase-options={pode ? opcoes.map((opcao) => opcao.short).join(" ") : undefined}
        aria-expanded={aberto}
        aria-haspopup="menu"
        disabled={!pode}
        onClick={() => {
          playSfx(aberto ? "click" : "open");
          setAberto((atual) => !atual);
        }}
        title={
          turn > 0
            ? `Turno ${turn} (${mine ? "seu" : "do oponente"}) — ${phase !== null ? phaseLabel(phase) : ""}${
                pode ? ". Clique para avançar de fase." : ""
              }`
            : "Duelo começando"
        }
        className={`md-phase-btn ${mine ? "md-phase-mine" : "md-phase-foe"} ${pode ? "md-phase-ready" : ""} ${
          batalha ? "md-phase-battle" : ""
        }`}
      >
        <span className="md-phase-face">
          <span className="md-phase-turn">{turn > 0 ? `Turn ${turn}` : "Duel"}</span>
          <span className="md-phase-name">{turn > 0 ? nome : "Start"}</span>
        </span>
      </button>
    </div>
  );
}

/** Os três estados da confirmação de ativação, com os rótulos do MD. */
const CHAIN_SHORT: Record<ChainResponseMode, string> = {
  auto: "Auto",
  always: "ON",
  never: "OFF",
};

/**
 * Os botões redondos do canto de baixo à direita do Master Duel:
 * confirmação de ativação (Auto/ON/OFF), "i" (informações do duelo), "!"
 * (o que está limitando as jogadas, com a contagem em cima) e o registro.
 *
 * Todos são controles da mesa, não jogadas (`data-table-control`).
 */
export function HudButtons({
  chainMode,
  forcing,
  onChainMode,
  infoOpen,
  onInfo,
  effectsCount,
  effectsOpen,
  onEffects,
  logOpen,
  onLog,
}: {
  /** `null` esconde o botão (quem só assiste não responde nada). */
  chainMode: ChainResponseMode | null;
  /** Ctrl segurado agora — o "segurar" do MD. */
  forcing: boolean;
  onChainMode: (mode: ChainResponseMode) => void;
  infoOpen: boolean;
  onInfo: () => void;
  effectsCount: number;
  effectsOpen: boolean;
  onEffects: () => void;
  logOpen: boolean;
  onLog: () => void;
}) {
  return (
    <div className="md-hud-buttons" data-table-control>
      {chainMode && (
        <button
          type="button"
          data-chain-mode={chainMode}
          data-chain-forcing={forcing || undefined}
          onClick={() => {
            playSfx("click");
            onChainMode(nextChainMode(chainMode));
          }}
          title={`Confirmação de ativação: ${CHAIN_MODE_LABEL[chainMode]}. ${CHAIN_MODE_HINT[chainMode]} Clique para trocar; segure Ctrl para parar em toda janela.`}
          className={`md-round md-round-chain md-round-chain-${chainMode} ${forcing ? "md-round-forcing" : ""}`}
        >
          <svg aria-hidden viewBox="0 0 24 24" className="md-round-glyph">
            <path d="M9.5 14.5l5-5M8 11l-2.2 2.2a3.2 3.2 0 004.5 4.5L12.5 15.5M16 13l2.2-2.2a3.2 3.2 0 00-4.5-4.5L11.5 8.5" />
          </svg>
          <span className="md-round-text">{forcing ? "Hold" : CHAIN_SHORT[chainMode]}</span>
        </button>
      )}
      <button
        type="button"
        data-duel-info
        aria-pressed={infoOpen}
        onClick={() => {
          playSfx("click");
          onInfo();
        }}
        title="Informações do duelo: ATK em campo, mão, Deck, Cemitério e banidas de cada um"
        className={`md-round ${infoOpen ? "md-round-on" : ""}`}
      >
        <span aria-hidden className="md-round-i">i</span>
      </button>
      <button
        type="button"
        data-duel-effects={effectsCount}
        aria-pressed={effectsOpen}
        onClick={() => {
          playSfx("click");
          onEffects();
        }}
        title="O que está limitando as jogadas agora"
        className={`md-round ${effectsOpen ? "md-round-on" : ""}`}
      >
        {effectsCount > 0 && <span className="md-round-count">{effectsCount}</span>}
        <svg aria-hidden viewBox="0 0 24 24" className="md-round-glyph">
          <path d="M12 4v9M12 17.5v.5M6.5 8.5a7 7 0 000 7M17.5 8.5a7 7 0 010 7M4 6a10.5 10.5 0 000 12M20 6a10.5 10.5 0 010 12" />
        </svg>
      </button>
      <button
        type="button"
        data-open-log
        aria-expanded={logOpen}
        onClick={() => {
          playSfx("click");
          onLog();
        }}
        title="Registro do duelo — tudo o que aconteceu até aqui"
        className={`md-round ${logOpen ? "md-round-on" : ""}`}
      >
        <svg aria-hidden viewBox="0 0 24 24" className="md-round-glyph">
          <path d="M8 4.5h8M9 3h6v3H9zM6.5 5H5.5v15.5h13V5h-1M8.5 10h7M8.5 13.5h7M8.5 17h4.5" />
        </svg>
      </button>
    </div>
  );
}
