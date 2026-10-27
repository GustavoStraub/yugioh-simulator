import { BotBrain } from "@/lib/duel/bot/bot-brain";
import { OfficialCardDb } from "@/lib/duel/official-card-data";
import type { BotAnalysisReply, BotAnalysisRequest } from "@/lib/duel/bot/analysis-protocol";

export function botAnalysisRuntime(send: (reply: BotAnalysisReply) => void) {
  let brain: BotBrain | null = null, cards: OfficialCardDb | null = null;
  return (request: BotAnalysisRequest) => {
    try {
      if (request.kind === "init") {
        cards = new OfficialCardDb(request.cards);
        brain = new BotBrain(request.config);
        send({ kind: "ready" });
        return;
      }
      if (!brain || !cards) throw new Error("Worker não inicializado");
      const { board, extractionMs, ...context } = request.observation;
      const response = brain.decide({ ...context, cardDb: cards, readBoard: () => board,
        decisionStartedAt: performance.now()-extractionMs });
      send({ kind: "result", revision: request.revision, response, trace: brain.lastTrace! });
    } catch (error) {
      send({ kind: "error", revision: request.kind === "decide" ? request.revision : undefined,
        message: error instanceof Error ? error.message : String(error) });
    }
  };
}
