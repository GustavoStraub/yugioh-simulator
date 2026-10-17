import type { BotRoute, BotStep } from "@/lib/duel/bot/deck-profile";
import type { BotEffect } from "@/lib/duel/bot/knowledge";

export interface BotIntent {
  code: number;
  description?: bigint;
  link?: number;
  route: string | null;
  step: string | null;
}

/** Intenções por efeito, sem guardar índices ou supor que escolher é resolver. */
export class BotIntentStack {
  private intents: BotIntent[] = [];
  begin(code: number, route: BotRoute | null, step: BotStep | null, description?: bigint): void {
    this.intents.push({ code, description: description !== undefined && description >= 0x100000n ? description : undefined,
      route: route?.id ?? null, step: step?.id ?? null });
    if (this.intents.length > 32) this.intents.shift();
  }
  current(effect?: BotEffect | null): BotIntent | null {
    if (!effect) return this.intents.at(-1) ?? null;
    if (effect.negated) return null;
    return this.intents.findLast((intent) => intent.code === effect.code
      && (intent.description === undefined || intent.description === effect.description)) ?? null;
  }
  clear(): void { this.intents = []; }
  invalidate(code: number): void { this.intents = this.intents.filter((intent) => intent.code !== code); }
}
