import type { OcgResponse } from "@n1xx1/ocgcore-wasm";
import type { BotDifficulty } from "@/lib/duel/bot/difficulty";
import type { OcgMessage } from "@n1xx1/ocgcore-wasm";
import type { BoardState } from "@/lib/duel/board-state";

export type BotDecisionSource = "automatic" | "heuristic" | "guide" | "route"
  | "fallback-unmodeled" | "fallback-error" | "rejected-recovery";

export interface BotActionIdentity {
  code: number;
  controller: number;
  location: number;
  sequence: number;
  description: string | null;
}

/** Uma resposta ao prompt atual; projeções nunca autorizam ações futuras. */
export interface BotCandidateTrace {
  id: string;
  source: BotDecisionSource;
  response: OcgResponse;
  score: number;
  components: Record<string, number>;
  reason: string;
  identity: BotActionIdentity | null;
  targets?: BotActionIdentity[];
  expected: string;
  confidence: "modeled" | "heuristic" | "unknown";
  resources: string[];
}

/** Diagnóstico privado. Não entra no snapshot, WebSocket ou log do adversário. */
export interface BotDecisionTrace {
  difficulty: BotDifficulty;
  profile: string | null;
  revision: number | null;
  turn: number;
  prompt: number;
  objective: string;
  route: string | null;
  guideDecision: string | null;
  guideLesson?: string | null;
  alternatives: { id: string; score: number; reason: string }[];
  source: BotDecisionSource;
  candidates: BotCandidateTrace[];
  capabilities: { candidateComparison: boolean; stateEvaluation: boolean; sequencePlanning: boolean; opponentMemory: boolean; recoveryPlanning: boolean; sliferStrategy?: boolean; heroStrategy?: boolean };
  selected: string;
  replacement: { reason: string; preferred: OcgResponse | null } | null;
  response: OcgResponse;
  reason: string;
  fallback: string | null;
  elapsedMs: number;
  budgetExhausted: boolean;
  execution?: { mode: "inline" | "worker"; extractionMs: number; analysisMs: number; transportMs: number; totalMs: number; recovery?: string };
  planning?: { goal: string|null; transition:string|null; branches:string[];
    predictions:{transition:string;turn:number;result:"confirmed"|"diverged"|"interrupted"}[] };
  observation: { me: 0 | 1; prompt: OcgMessage; board: BoardState | null; lifePoints: readonly [number, number]; phase: number | null; chainCode: number | null; resolvingCode: number | null; resolvingPlayer: number | null; resolvingDescription: string | null; step: string | null };
}

export interface BotDiagnostics {
  decisions: number;
  fallbacks: number;
  rejected: number;
  replans: number;
  budgetExhaustions: number;
  timings: number[];
  sources: Record<BotDecisionSource, number>;
}

export function newBotDiagnostics(): BotDiagnostics {
  return { decisions: 0, fallbacks: 0, rejected: 0, replans: 0, budgetExhaustions: 0, timings: [],
    sources: { automatic: 0, heuristic: 0, guide: 0, route: 0, "fallback-unmodeled": 0,
      "fallback-error": 0, "rejected-recovery": 0 } };
}

export function timingPercentiles(samples: readonly number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const p = (n: number) => sorted[Math.max(0, Math.ceil(sorted.length * n) - 1)] ?? 0;
  return { median: p(0.5), p95: p(0.95), p99: p(0.99) };
}
