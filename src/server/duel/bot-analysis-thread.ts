import { parentPort } from "node:worker_threads";
import { botAnalysisRuntime } from "@/lib/duel/bot/analysis-runtime";
if (!parentPort) throw new Error("Thread de análise sem canal");
const port = parentPort;
port.on("message",botAnalysisRuntime(reply=>port.postMessage(reply)));
