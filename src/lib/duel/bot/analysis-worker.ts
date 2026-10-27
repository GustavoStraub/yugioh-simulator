import { botAnalysisRuntime } from "@/lib/duel/bot/analysis-runtime";
import type { BotAnalysisReply, BotAnalysisRequest } from "@/lib/duel/bot/analysis-protocol";
const scope = globalThis as unknown as {
  postMessage(reply: BotAnalysisReply): void;
  onmessage: (event: MessageEvent<BotAnalysisRequest>) => void;
};
const handle = botAnalysisRuntime(reply => scope.postMessage(reply));
scope.onmessage = event => handle(event.data);
