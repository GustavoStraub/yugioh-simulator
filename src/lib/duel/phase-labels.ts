import { OcgPhase } from "@n1xx1/ocgcore-wasm";

const PHASE_LABELS: Record<number, string> = {
  [OcgPhase.DRAW]: "Draw Phase",
  [OcgPhase.STANDBY]: "Standby Phase",
  [OcgPhase.MAIN1]: "Main Phase 1",
  [OcgPhase.BATTLE_START]: "Battle Phase",
  [OcgPhase.BATTLE_STEP]: "Battle Step",
  [OcgPhase.DAMAGE]: "Damage Step",
  [OcgPhase.DAMAGE_CAL]: "Damage Calculation",
  [OcgPhase.BATTLE]: "Battle Phase (fim)",
  [OcgPhase.MAIN2]: "Main Phase 2",
  [OcgPhase.END]: "End Phase",
};

export function phaseLabel(phase: number): string {
  return PHASE_LABELS[phase] ?? `Fase ${phase}`;
}

/** Os passos da Battle Phase — todos são "Battle" no botão e na faixa. */
const BATTLE_STEPS =
  OcgPhase.BATTLE_START | OcgPhase.BATTLE_STEP | OcgPhase.DAMAGE | OcgPhase.DAMAGE_CAL | OcgPhase.BATTLE;

/**
 * O nome curto da fase no botão redondo do Master Duel ("Turn 3 / Main1").
 * Em inglês estilizado, como no jogo em qualquer idioma — decisão do Gustavo.
 */
export function mdPhaseShort(phase: number): string {
  switch (phase) {
    case OcgPhase.DRAW:
      return "Draw";
    case OcgPhase.STANDBY:
      return "Standby";
    case OcgPhase.MAIN1:
      return "Main1";
    case OcgPhase.MAIN2:
      return "Main2";
    case OcgPhase.END:
      return "End";
    default:
      return (phase & BATTLE_STEPS) !== 0 ? "Battle" : "—";
  }
}

/**
 * A faixa que atravessa a tela na troca de fase ("BATTLE PHASE"). Só as
 * fases que o jogador enxerga: os passos internos da batalha não ganham faixa
 * (a do início dela basta), e o fim da batalha também não.
 */
export function mdPhaseBanner(phase: number): string | null {
  switch (phase) {
    case OcgPhase.DRAW:
      return "DRAW PHASE";
    case OcgPhase.STANDBY:
      return "STANDBY PHASE";
    case OcgPhase.MAIN1:
      return "MAIN PHASE 1";
    case OcgPhase.BATTLE_START:
      return "BATTLE PHASE";
    case OcgPhase.MAIN2:
      return "MAIN PHASE 2";
    case OcgPhase.END:
      return "END PHASE";
    default:
      return null;
  }
}

/**
 * Trilha de fases exibida na lateral da mesa, como nos jogos Tag Force.
 * Só as fases que o jogador realmente enxerga — os passos internos da Battle
 * Phase (Battle Step, Damage) ficam agrupados sob "BP".
 */
export const PHASE_TRACK = [
  { value: OcgPhase.DRAW, short: "DP" },
  { value: OcgPhase.STANDBY, short: "SP" },
  { value: OcgPhase.MAIN1, short: "M1" },
  { value: OcgPhase.BATTLE_START, short: "BP" },
  { value: OcgPhase.MAIN2, short: "M2" },
  { value: OcgPhase.END, short: "EP" },
] as const;
