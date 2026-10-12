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
