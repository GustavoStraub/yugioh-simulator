import { BotBrain, type BotConfig, type BotContext } from "@/lib/duel/bot/bot-brain";
import { autoResponseFor } from "@/lib/duel/auto-response";
import { botObservation, type BotAnalysisReply, type BotAnalysisTransport, type BotPilot } from "@/lib/duel/bot/analysis-protocol";
import { validBotResponse } from "@/lib/duel/bot/response-validator";
import type { OfficialCardDb } from "@/lib/duel/official-card-data";
import type { OcgResponse } from "@n1xx1/ocgcore-wasm";

/** Uma análise por sessão/assento. Cancelar destrói o worker e invalida a revisão. */
export class BotAnalysisController implements BotPilot {
  private readonly local: BotBrain;
  private revision = 0;
  private disposed = false;
  private failed = false;
  private readonly ready: Promise<void>;
  private settleReady: (() => void) | null = null;
  private pending: { revision: number; finish: (reply: BotAnalysisReply | null) => void } | null = null;
  private readonly unlisten: () => void;
  private readonly config: BotConfig;
  private readonly transport: BotAnalysisTransport;

  constructor(config: BotConfig, transport: BotAnalysisTransport, cards: OfficialCardDb) {
    this.config=config;this.transport=transport;
    this.local = new BotBrain({ ...config, onDecision: trace => {
      if (this.failed) {
        trace.source="fallback-error";
        trace.fallback="Worker indisponível; recuperou com análise local";
        const candidate=trace.candidates.find(c=>c.id===trace.selected);
        if(candidate) { candidate.source="fallback-error"; candidate.id=`fallback-error:${candidate.id}`; trace.selected=candidate.id; }
      }
      trace.execution={mode:"inline",extractionMs:0,analysisMs:trace.elapsedMs,transportMs:0,totalMs:trace.elapsedMs,
        ...(this.failed?{recovery:trace.fallback!}:{})};
      try { config.onDecision?.(trace); } catch { /* diagnóstico privado */ }
    } });
    this.ready = new Promise(resolve => { this.settleReady = resolve; });
    this.unlisten = transport.listen(reply => {
      if (this.disposed) return;
      if (reply.kind === "ready") { this.settleReady?.(); this.settleReady = null; }
      else if (reply.kind === "error") this.fail();
      else if (this.pending?.revision === reply.revision) this.pending.finish(reply);
    }, () => this.fail());
    const { onDecision: _callback, ...options } = config;
    void _callback;
    try { transport.send({ kind: "init", config: options, cards: cards.serialize() }); }
    catch { this.fail(); }
  }

  private fail(): void {
    this.failed = true;
    this.transport.terminate();
    this.settleReady?.(); this.settleReady = null;
    this.pending?.finish(null);
  }

  async initialize(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.ready, new Promise<void>(resolve => { timer=setTimeout(()=>{this.fail();resolve();},5000); })]);
    clearTimeout(timer);
  }

  async decide(ctx: BotContext): Promise<OcgResponse | null> {
    if (this.disposed) return null;
    const revision = ++this.revision;
    // Não há busca a isolar quando só existe uma resposta.
    if (autoResponseFor(ctx.prompt,{resolvingCode:ctx.resolvingEffect?.code})) return this.local.decide(ctx);
    if (this.failed) return this.local.decide(ctx);
    if (this.pending) { this.fail(); return this.local.decide(ctx); }
    await this.ready;
    if (this.disposed || revision !== this.revision) return null;
    if (this.failed) return this.local.decide(ctx);
    const started = ctx.decisionStartedAt ?? performance.now();
    const observation = botObservation(ctx);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await new Promise<BotAnalysisReply | null>(resolve => {
      this.pending = { revision, finish: reply => { clearTimeout(timer); this.pending=null; resolve(reply); } };
      timer=setTimeout(()=>this.fail(),1000);
      try { this.transport.send({kind:"decide",revision,observation}); } catch { this.fail(); }
    });
    if (this.disposed || revision !== this.revision) return null;
    if (result?.kind !== "result" || !validBotResponse(ctx.prompt,result.response,ctx.cardDb)) {
      this.fail(); return this.local.decide(ctx);
    }
    const analysisMs=Math.max(0,result.trace.elapsedMs-observation.extractionMs);
    result.trace.elapsedMs=performance.now()-started;
    result.trace.execution={mode:"worker",extractionMs:observation.extractionMs,analysisMs,
      transportMs:Math.max(0,result.trace.elapsedMs-analysisMs-observation.extractionMs),totalMs:result.trace.elapsedMs};
    try { this.config.onDecision?.(result.trace); } catch { /* diagnóstico privado */ }
    return result.response;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.revision++;
    this.pending?.finish(null);
    this.settleReady?.(); this.settleReady=null;
    this.unlisten(); this.transport.terminate();
  }
}

export async function createBotPilot(config: BotConfig, cards: OfficialCardDb, factory?: () => BotAnalysisTransport): Promise<BotPilot> {
  if (!factory || config.execution === "inline") return new BotBrain(config);
  try {
    const controller = new BotAnalysisController(config,factory(),cards);
    await controller.initialize();
    return controller;
  } catch { return new BotBrain(config); }
}
