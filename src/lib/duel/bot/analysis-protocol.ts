import type { OcgResponse } from "@n1xx1/ocgcore-wasm";
import type { BoardState } from "@/lib/duel/board-state";
import type { BotConfig, BotContext } from "@/lib/duel/bot/bot-brain";
import type { BotDecisionTrace } from "@/lib/duel/bot/decision-trace";
import type { CardDb } from "@/lib/duel/official-card-data";

export type BotObservation = Omit<BotContext, "readBoard" | "cardDb" | "decisionStartedAt"> & { board: BoardState; extractionMs: number };
export type BotAnalysisRequest = { kind: "init"; config: Omit<BotConfig,"onDecision">; cards: CardDb }
  | { kind: "decide"; revision: number; observation: BotObservation };
export type BotAnalysisReply = { kind: "ready" } | { kind: "error"; revision?: number; message: string }
  | { kind: "result"; revision: number; response: OcgResponse; trace: BotDecisionTrace };
export interface BotAnalysisTransport {
  send(request: BotAnalysisRequest): void;
  listen(receive: (reply: BotAnalysisReply) => void, failed: (error: Error) => void): () => void;
  terminate(): void;
}
export interface BotPilot {
  decide(ctx: BotContext): OcgResponse | Promise<OcgResponse | null>;
  dispose?(): void;
}

/** A fronteira do worker só recebe a observação permitida, nunca um handle. */
export function botObservation(ctx: BotContext): BotObservation {
  const { readBoard, cardDb: _cards, decisionStartedAt, ...context } = ctx;
  void _cards;
  const board = readBoard(true);
  return { ...context, board, extractionMs: performance.now()-(decisionStartedAt??performance.now()) };
}
