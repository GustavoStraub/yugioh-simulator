import type { DuelDeckPayload, DuelFormat } from "@/lib/types";
import type { BoardPlayer } from "@/lib/duel/board-state";

export type BotZone = "hand" | "monsters" | "spells" | "grave" | "banished" | "extra";
export interface BotDeckRequirements {
  main: { code: number; count: number }[];
  extra: { code: number; count: number }[];
  alternatives?: { zone: "main" | "extra"; minCount: number; codes: number[] }[];
  forbidden?: number[];
}
export type BotCondition =
  | { kind: "card"; zone: BotZone; code: number; count?: number; absent?: boolean }
  | { kind: "offered"; code: number; location: number }
  | { kind: "lp"; player: 0 | 1; value: number };
export interface BotTarget { code: number; location: number; controller?: number; scope?: "action" | "selection" }
export interface BotStep {
  id: string;
  effects: number[];
  /** Índices de aux.Stringid por carta; omitidos somente em procedimentos sem elo. */
  effectIndices?: Record<string, number[]>;
  action?: { kind: "summons" | "special_summons" | "activates"; code: number };
  targets: BotTarget[];
  completeWhen: BotCondition[];
  spend?: "discard" | "return" | "banish";
  spendCount?: number;
  options?: number[];
}
export interface BotRoute {
  deckRequirements?: BotDeckRequirements;
  id: string;
  minDifficulty?: "hard";
  lesson: string;
  objective: string;
  requires: { code: number; zone: BotZone | "deck"; count: number }[];
  minHand: number;
  reserves: number[];
  steps: BotStep[];
  result: { pressure: number; interaction: number; continuation: number; cost: number; exposure: number };
}
export interface BotDeckProfile {
  engineRequirements?: BotDeckRequirements;
  compatibility?: { mode: "partial"; sourceSignature: string; disabledRoutes: string[] };
  schemaVersion: 1;
  id: string;
  revision: number;
  format: DuelFormat;
  presetId: string;
  guide: { id: string; revision: number };
  deckSnapshot: DuelDeckPayload;
  roles: { code: number; roles: ("starter" | "extender" | "interaction" | "recovery" | "finisher" | "material")[] }[];
  routes: BotRoute[];
  coverage: string;
}

/** Ordenação da lista não faz parte do conhecimento nem da compatibilidade. */
export function deckSignature(deck: DuelDeckPayload, format: DuelFormat = deck.format ?? "goat"): string {
  const bag = (cards: readonly number[] = []) => [...cards].sort((a, b) => a - b).join(",");
  return `${format}:${bag(deck.main)}|${bag(deck.extra)}|${bag(deck.side)}`;
}

export function matchesBotProfile(profile: BotDeckProfile, deck: DuelDeckPayload, format: DuelFormat): boolean {
  return profile.schemaVersion === 1 && profile.format === format
    && deckSignature(profile.deckSnapshot, profile.format) === deckSignature(deck, format);
}

export function satisfiesDeckRequirements(deck: DuelDeckPayload, requirements: BotDeckRequirements): boolean {
  return (["main","extra"] as const).every(zone=>requirements[zone].every(r=>deck[zone].filter(code=>code===r.code).length>=r.count))
    && (requirements.alternatives??[]).every(r=>deck[r.zone].filter(code=>r.codes.includes(code)).length>=r.minCount)
    && !(requirements.forbidden??[]).some(code=>[...deck.main,...deck.extra].includes(code));
}

/** Exige declaração editorial de cada rota; sem ela a compatibilidade parcial não é inferida. */
export function compatibleBotProfile(profile: BotDeckProfile, deck: DuelDeckPayload, format: DuelFormat): BotDeckProfile | null {
  if (!validateBotProfile(profile) || profile.format!==format) return null;
  if (matchesBotProfile(profile,deck,format)) return profile;
  if (!profile.engineRequirements || !satisfiesDeckRequirements(deck,profile.engineRequirements)) return null;
  const routes=profile.routes.filter(route=>route.deckRequirements&&satisfiesDeckRequirements(deck,route.deckRequirements));
  if (!routes.length) return null;
  return { ...profile, routes, compatibility:{mode:"partial",sourceSignature:deckSignature(profile.deckSnapshot,format),
    disabledRoutes:[...new Set([...(profile.compatibility?.disabledRoutes??[]),
      ...profile.routes.filter(route=>!routes.includes(route)).map(route=>route.id)])]} };
}

function validRequirements(value: BotDeckRequirements | undefined, codes: Set<number>): boolean {
  if (!value) return true;
  return ["main","extra"].every(zone=>Array.isArray(value[zone as "main"|"extra"]))
    && [...value.main,...value.extra].every(r=>codes.has(r.code)&&Number.isInteger(r.count)&&r.count>0)
    && (value.alternatives??[]).every(r=>["main","extra"].includes(r.zone)&&Number.isInteger(r.minCount)&&r.minCount>0
      && r.codes.length>0&&r.codes.every(code=>codes.has(code)))
    && (value.forbidden??[]).every(code=>Number.isSafeInteger(code)&&code>0);
}

/** Rejeita dados inválidos antes de o planejador poder executá-los. */
export function validateBotProfile(value: unknown): value is BotDeckProfile {
  try {
  if (!value || typeof value !== "object") return false;
  const profile = value as BotDeckProfile;
  if (!profile.deckSnapshot || !Array.isArray(profile.deckSnapshot.main) || !Array.isArray(profile.deckSnapshot.extra)
    || !Array.isArray(profile.deckSnapshot.side) || !Array.isArray(profile.routes) || !Array.isArray(profile.roles)
    || !profile.guide || !Number.isInteger(profile.guide.revision) || profile.guide.revision <= 0
    || !["goat", "tcg"].includes(profile.format) || typeof profile.id !== "string" || typeof profile.presetId !== "string") return false;
  const codes = new Set([...profile.deckSnapshot.main, ...profile.deckSnapshot.extra, ...profile.deckSnapshot.side]);
  if ([...codes].some((c) => !Number.isInteger(c) || c <= 0)) return false;
  const ids = new Set<string>();
  const zones = new Set(["hand", "monsters", "spells", "grave", "banished", "extra", "deck"]);
  return profile.schemaVersion === 1 && Number.isInteger(profile.revision) && profile.revision > 0
    && validRequirements(profile.engineRequirements,codes)
    && profile.roles.every((r) => codes.has(r.code) && r.roles.every((role) => ["starter", "extender", "interaction", "recovery", "finisher", "material"].includes(role)))
    && profile.routes.length > 0 && profile.routes.every((route) => {
      if (ids.has(route.id)) return false;
      ids.add(route.id);
      return (!route.minDifficulty || route.minDifficulty === "hard")
        && validRequirements(route.deckRequirements,codes)
        && typeof route.id === "string" && typeof route.lesson === "string" && Number.isInteger(route.minHand) && route.minHand >= 0
        && Object.values(route.result).every((n) => Number.isFinite(n) && n >= 0)
        && route.steps.length > 0 && route.requires.every((r) => codes.has(r.code) && zones.has(r.zone) && Number.isInteger(r.count) && r.count > 0)
        && route.reserves.every((code) => codes.has(code))
        && route.steps.every((step) => step.targets.every((t) => codes.has(t.code) && [1, 2, 4, 8, 16, 32, 64].includes(t.location))
          && step.effects.every((code) => codes.has(code))
          && (!step.action || codes.has(step.action.code) && ["summons", "special_summons", "activates"].includes(step.action.kind))
          && (!step.spend || ["discard", "return", "banish"].includes(step.spend))
          && (step.spendCount === undefined || Number.isInteger(step.spendCount) && step.spendCount > 0)
          && (!step.effectIndices || Object.entries(step.effectIndices).every(([code, indices]) => codes.has(Number(code))
            && indices.every((n) => Number.isInteger(n) && n >= 0 && n < 0x100000)))
          && step.completeWhen.every((c) => c.kind === "card" ? codes.has(c.code) && zones.has(c.zone)
            : c.kind === "offered" ? codes.has(c.code) : c.kind === "lp" && Number.isFinite(c.value)));
    });
  } catch { return false; }
}

export function stepHasEffect(step: BotStep, code: number, description?: bigint): boolean {
  if (!step.effects.includes(code)) return false;
  const indices = step.effectIndices?.[String(code)];
  // SELECT_EFFECTYN também usa strings de sistema (221 = ativar efeito?).
  // Elas não identificam o efeito; a descrição específica chega no CHAINING.
  return !indices || description === undefined || description < 0x100000n
    || indices.some((i) => description === (BigInt(code) << 20n) + BigInt(i));
}

/** Contagem da própria lista menos cartas acessíveis; não consulta o Deck do core. */
export function remainingInDeck(deck: DuelDeckPayload, mine: BoardPlayer, code: number): number {
  const visible = [...mine.hand, ...mine.monsters, ...mine.spells, ...mine.grave, ...mine.banished];
  return Math.max(0, deck.main.filter((c) => c === code).length - visible.filter((c) => c?.code === code).length);
}

const LOADERS = [
  async () => ({ profile: (await import("@/data/bot-profiles/albaz-strike.json")).default,
    guide: (await import("@/data/deck-guides/albaz-strike.json")).default }),
  async () => ({ profile: (await import("@/data/bot-profiles/herois-lendarios-aesir.json")).default,
    guide: (await import("@/data/deck-guides/herois-lendarios-aesir.json")).default }),
  async () => ({ profile: (await import("@/data/bot-profiles/herois-lendarios-destiny-hero.json")).default,
    guide: (await import("@/data/deck-guides/herois-lendarios-destiny-hero.json")).default }),
  async () => ({ profile: (await import("@/data/bot-profiles/herois-lendarios-cavaleiros-fantasmas.json")).default,
    guide: (await import("@/data/deck-guides/herois-lendarios-cavaleiros-fantasmas.json")).default }),
];
const LOADER_BY_ID: Record<string, typeof LOADERS[number]> = {
  "albaz-strike": LOADERS[0],
  "herois-lendarios-aesir": LOADERS[1],
  "herois-lendarios-destiny-hero": LOADERS[2],
  "herois-lendarios-cavaleiros-fantasmas": LOADERS[3],
};

// O índice só contém assinaturas e cobertura. Os roteiros e o guia de revisão
// entram em chunks separados e só o candidato da própria lista é carregado.
import manifest from "@/data/bot-profiles/manifest.json";
export function botCoverage(deck: DuelDeckPayload, format: DuelFormat) {
  return manifest.find((entry) => entry.signature === deckSignature(deck, format)) ?? null;
}

export async function loadBotProfile(deck: DuelDeckPayload, format: DuelFormat, options: { allowPartial?: boolean } = {}): Promise<BotDeckProfile | null> {
  const candidate = manifest.find((entry) => entry.signature === deckSignature(deck, format));
  if (!candidate && options.allowPartial) {
    const matches=await Promise.all(manifest.map(async entry=>{
      try {
        if(!LOADER_BY_ID[entry.id]) return null;
        const raw=(await LOADER_BY_ID[entry.id]()).profile as BotDeckProfile;
        const original=await loadBotProfile(raw.deckSnapshot,format);
        return original?compatibleBotProfile(original,deck,format):null;
      } catch { return null; }
    }));
    return matches.filter((profile): profile is BotDeckProfile=>Boolean(profile))
      .sort((a,b)=>b.routes.length-a.routes.length||a.id.localeCompare(b.id))[0]??null;
  }
  if (!candidate || !LOADER_BY_ID[candidate.id]) return null;
  try {
    const { profile: raw, guide } = await LOADER_BY_ID[candidate.id]();
    const profile = raw as BotDeckProfile;
    if (!validateBotProfile(profile) || !matchesBotProfile(profile, deck, format)
      || profile.guide.id !== guide.id || profile.guide.revision !== guide.revision
      || deckSignature(profile.deckSnapshot, format) !== deckSignature(guide.deckSnapshot as DuelDeckPayload, format)) return null;
    return profile;
  } catch {
    return null;
  }
}
