import type { OcgResponse } from "@n1xx1/ocgcore-wasm";
import type { BotDifficulty } from "@/lib/duel/bot/difficulty";
import type { OcgMessage } from "@n1xx1/ocgcore-wasm";
import type { BoardState } from "@/lib/duel/board-state";

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
  alternatives: { id: string; score: number; reason: string }[];
  response: OcgResponse;
  reason: string;
  fallback: string | null;
  elapsedMs: number;
  budgetExhausted: boolean;
  observation: { me: 0 | 1; prompt: OcgMessage; board: BoardState | null; lifePoints: readonly [number, number]; phase: number | null; chainCode: number | null; resolvingCode: number | null; resolvingPlayer: number | null; resolvingDescription: string | null; step: string | null };
}

export interface BotDiagnostics {
  decisions: number;
  fallbacks: number;
  rejected: number;
  replans: number;
  budgetExhaustions: number;
  timings: number[];
}

export function newBotDiagnostics(): BotDiagnostics {
  return { decisions: 0, fallbacks: 0, rejected: 0, replans: 0, budgetExhaustions: 0, timings: [] };
}

export function timingPercentiles(samples: readonly number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const p = (n: number) => sorted[Math.max(0, Math.ceil(sorted.length * n) - 1)] ?? 0;
  return { median: p(0.5), p95: p(0.95), p99: p(0.99) };
}
