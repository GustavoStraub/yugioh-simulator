import { Worker } from "node:worker_threads";
import type { BotAnalysisTransport } from "@/lib/duel/bot/analysis-protocol";
export function nodeBotAnalysisTransport(): BotAnalysisTransport {
  const worker = new Worker(new URL("./bot-analysis-thread.ts",import.meta.url),{
    execArgv:["--import",new URL("../../../tools/harness/ts-loader-register.mjs",import.meta.url).href],
  });
  return {
    send(request) { worker.postMessage(request); },
    listen(receive,failed) {
      worker.on("message",receive);worker.on("error",failed);
      const exit=(code:number)=>{if(code!==0) failed(new Error(`Thread encerrou com código ${code}`));};worker.on("exit",exit);
      return()=>{worker.off("message",receive);worker.off("error",failed);worker.off("exit",exit);};
    },
    terminate() { void worker.terminate(); },
  };
}
