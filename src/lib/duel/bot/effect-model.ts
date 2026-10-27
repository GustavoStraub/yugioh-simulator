import { OcgLocation as L } from "@n1xx1/ocgcore-wasm";
import type { BotContext } from "@/lib/duel/bot/bot-brain";
import { roleOf } from "@/lib/duel/bot/card-intel";

export interface EffectModel {
  kind: "search" | "extension" | "removal" | "negation" | "recovery" | "draw" | "boost";
  impact: number;
  cost: number;
  targeted: boolean;
  restriction?: string;
}
// Índices conferidos nos scripts fixados do core. Ausência de modelo permanece explícita.
const EFFECTS: Record<number, Record<number, EffectModel>> = {
  44362883: { 0: { kind: "extension", impact: 96, cost: 0, targeted: false, restriction: "fusion-only" } },
  45484331: {
    0: { kind: "extension", impact: 60, cost: 0, targeted: false },
    1: { kind: "search", impact: 78, cost: 1, targeted: false },
  },
  90432163: {
    0: { kind: "boost", impact: 22, cost: 0, targeted: true },
    1: { kind: "search", impact: 82, cost: 1, targeted: false },
  },
  36426778: { 1: { kind: "search", impact: 82, cost: 1, targeted: false } },
  62709239: {
    0: { kind: "removal", impact: 82, cost: 1, targeted: true },
    1: { kind: "recovery", impact: 90, cost: 0, targeted: true, restriction: "dark-only" },
  },
  14558127: { 0: { kind: "negation", impact: 80, cost: 1, targeted: false } },
  97268402: { 0: { kind: "negation", impact: 78, cost: 1, targeted: true } },
  1475311: { 0: { kind: "draw", impact: 38, cost: 1, targeted: false } },
  32807846: { 0: { kind: "search", impact: 72, cost: 0, targeted: false } },
  86377375: {0:{kind:"search",impact:72,cost:1,targeted:false},1:{kind:"draw",impact:42,cost:1,targeted:false}},
  23898021: {0:{kind:"search",impact:76,cost:1,targeted:false}},
  91812341: {0:{kind:"search",impact:70,cost:0,targeted:false},1:{kind:"removal",impact:76,cost:0,targeted:true}},
  3534077: {0:{kind:"recovery",impact:78,cost:0,targeted:true}},
  41230939: {0:{kind:"recovery",impact:66,cost:0,targeted:true}},
  18621798: {0:{kind:"negation",impact:90,cost:1,targeted:false},1:{kind:"recovery",impact:72,cost:0,targeted:true}},
  18967507: {0:{kind:"recovery",impact:72,cost:0,targeted:false},1:{kind:"negation",impact:94,cost:1,targeted:false}},
  33198837: {0:{kind:"negation",impact:90,cost:1,targeted:false}},
  92892239: {0:{kind:"removal",impact:82,cost:1,targeted:true},1:{kind:"recovery",impact:78,cost:1,targeted:true}},
  45803070: {0:{kind:"recovery",impact:78,cost:0,targeted:true},1:{kind:"recovery",impact:66,cost:0,targeted:true}},
  74577599: {0:{kind:"extension",impact:65,cost:1,targeted:false},2:{kind:"recovery",impact:78,cost:1,targeted:true}},
  73639099: {0:{kind:"extension",impact:88,cost:0,targeted:false},1:{kind:"search",impact:68,cost:0,targeted:false}},
  90681088: {0:{kind:"extension",impact:58,cost:0,targeted:false},1:{kind:"search",impact:82,cost:0,targeted:false},2:{kind:"recovery",impact:60,cost:0,targeted:false}},
  57554544: {0:{kind:"search",impact:84,cost:1,targeted:false},1:{kind:"extension",impact:62,cost:0,targeted:false},2:{kind:"removal",impact:92,cost:0,targeted:false}},
  82562802: {0:{kind:"recovery",impact:60,cost:0,targeted:true},1:{kind:"search",impact:78,cost:1,targeted:false},2:{kind:"extension",impact:62,cost:0,targeted:false}},
  64753988: {0:{kind:"extension",impact:70,cost:0,targeted:false}},
  5998840: {0:{kind:"extension",impact:80,cost:0,targeted:false}},
  51808422: {0:{kind:"recovery",impact:82,cost:0,targeted:true}},
  87292536: {0:{kind:"recovery",impact:68,cost:0,targeted:true}},
  44335251: {0:{kind:"search",impact:88,cost:0,targeted:false},1:{kind:"recovery",impact:82,cost:1,targeted:true}},
  18940556: {0:{kind:"removal",impact:95,cost:1,targeted:false},1:{kind:"removal",impact:85,cost:0,targeted:false}},
  68464358: {0:{kind:"extension",impact:84,cost:1,targeted:true,restriction:"dark-only"}},
  36668118: {0:{kind:"recovery",impact:82,cost:0,targeted:false}},
  31443476: {0:{kind:"extension",impact:84,cost:0,targeted:false}},
  14464864: { 0: { kind: "search", impact: 72, cost: 0, targeted: false } },
};

export function effectModel(code: number, description?: bigint | null): EffectModel | null {
  const models = EFFECTS[code];
  if (!models) return null;
  const index = description !== undefined && description !== null && description >= 0x100000n
    ? Number(description - (BigInt(code) << 20n)) : null;
  // Uma descrição de sistema não distingue os dois efeitos da mesma carta.
  if (index !== null) return models[index] ?? null;
  return Object.keys(models).length === 1 ? Object.values(models)[0] : null;
}

/** null deixa o comportamento genérico intacto para efeitos não cobertos. */
export function interruptionValue(card: { code: number; location: number }, ctx: BotContext): number | null {
  if (ctx.chainPlayer === ctx.me) return -1;
  if (card.code !== 14558127 && card.code !== 97268402) return null;
  if (card.code===97268402&&ctx.chainEffect?.location!==undefined&&ctx.chainEffect.location!==L.MZONE) return -1;
  if (ctx.chainPlayer === null || ctx.chainPlayer === undefined || !ctx.chainCode) {
    // Veiler oferecido numa janela livre não é motivo para gastá-lo antes de um efeito.
    return card.code === 97268402 ? -1 : null;
  }
  const model = effectModel(ctx.chainCode, ctx.chainEffect?.description);
  if (!model) return null;
  const board = ctx.readBoard(false), mine = board.players[ctx.me], foe = board.players[1-ctx.me];
  const pressure = foe.monsters.reduce((sum,c) => sum + (c && !c.faceDown && !c.defense ? c.attack ?? 0 : 0), 0);
  const urgent = pressure >= ctx.lifePoints[ctx.me];
  // Buff que abre dano fatal deve ser negado mesmo sendo de pouco valor em outra mesa.
  const nearLethal = model.kind === "boost" && pressure + 800 >= ctx.lifePoints[ctx.me];
  const another = [...mine.hand, ...mine.monsters, ...mine.spells].some(c => c?.code
    && c.code !== card.code && (c.code === 14558127 || c.code === 97268402 || c.code === 44146295));
  return model.impact + (urgent || nearLethal ? 55 : 0) + (another ? 5 : -6);
}

export function knownInteraction(code: number): boolean {
  return code === 14558127 || code === 97268402 || code === 44146295
    || ["battleTrap", "spotRemoval"].includes(roleOf(code) ?? "");
}

/** Não confundir uma interação no cemitério com uma carta conhecida na mão. */
export function responsePlace(place: string | null, player: number): boolean {
  return Boolean(place?.startsWith(`${player}:${L.HAND}:`) || place?.startsWith(`${player}:${L.SZONE}:`));
}
