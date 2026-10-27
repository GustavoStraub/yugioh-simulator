import { OcgLocation as L, OcgRace, type OcgCardLoc } from "@n1xx1/ocgcore-wasm";
import type { BoardCard, BoardPlayer } from "@/lib/duel/board-state";
import type { BotContext } from "@/lib/duel/bot/bot-brain";
import { readIntel } from "@/lib/duel/bot/card-intel";
import { ownValue, threatOf } from "@/lib/duel/bot/combat";

type Effect = { code: number; description?: bigint; location?: number; sequence?: number };
type Removal = { zone: "backrow" | "monster" | "field"; face?: "up" | "down"; paired?: boolean; discard?: boolean };

// Efeitos e filtros conferidos nos Lua fixados em cardscripts-pin.ts.
// O índice é parte da identidade: o segundo efeito de Break Sword reanima.
const REMOVAL: Record<number, Removal> = {
  5318639: { zone: "backrow" }, // Mystical Space Typhoon
  60082869: { zone: "backrow" }, // Dust Tornado
  17449108: { zone: "backrow", face: "down" },
  45939841: { zone: "backrow", face: "up" }, // Twister
  8267140: { zone: "backrow" }, // Cosmic Cyclone
  43898403: { zone: "backrow", discard: true }, // Twin Twisters
  23924608: { zone: "backrow" }, // Heavy Storm Duster
  6983839: { zone: "backrow" }, // Tornado Dragon
  22624373: { zone: "backrow" }, // Lyla
  71044499: { zone: "monster", face: "down" },
  4178474: { zone: "field", discard: true }, // Raigeki Break
  63356631: { zone: "field", discard: true }, // Phoenix Wing Wind Blast
  84290642: { zone: "field", discard: true }, // Snipe Hunter
  76774528: { zone: "field", paired: true }, // Scrap Dragon
  62709239: { zone: "field", paired: true }, // Break Sword
  95169481: { zone: "field", paired: true }, // Diamond Dire Wolf
};

function indexOf(effect: Effect): number | null {
  return effect.description !== undefined && effect.description >= 0x100000n
    ? Number(effect.description - (BigInt(effect.code) << 20n)) : null;
}

function removalFor(effect: Effect): Removal | null {
  // Castel: virar monstro (0) e devolver carta face-up (1) têm filtros distintos.
  if (effect.code === 82633039 && effect.location !== L.GRAVE) {
    const index = indexOf(effect);
    return index === 0 ? { zone: "monster", face: "up" }
      : index === 1 ? { zone: "field", face: "up" } : null;
  }
  if (!REMOVAL[effect.code]) return null;
  const index = indexOf(effect);
  if (index !== null && index !== 0) return null;
  // Não confundir uma recuperação no cemitério com a remoção no campo.
  if (effect.location === L.GRAVE || effect.location === L.REMOVED) return null;
  return REMOVAL[effect.code];
}

const fieldCards = (player: BoardPlayer): BoardCard[] =>
  [...player.monsters, ...player.spells, player.field].filter((c): c is BoardCard => Boolean(c));

function matches(card: BoardCard, model: Removal): boolean {
  const monster = card.location === L.MZONE;
  if (model.zone === "monster" && !monster || model.zone === "backrow" && monster) return false;
  // Não lê a identidade das cartas adversárias viradas para baixo.
  return !model.face || (model.face === "down" ? card.faceDown : !card.faceDown);
}

function fieldValue(card: BoardCard, ctx: BotContext, own: boolean): number {
  if (!own && card.location === L.MZONE && card.faceDown) return 1500;
  // ATK/DEF de magias são zero; isso não faz uma armadilha ser descartável.
  return card.location === L.MZONE
    ? Math.max(500, own ? ownValue(card, ctx.cardDb) : threatOf(card, ctx.cardDb))
    : 1400;
}

function breakSwordRecovery(card: BoardCard, ctx: BotContext): number {
  if (card.code !== 62709239 || card.negated || card.faceDown) return 0;
  const mine = ctx.readBoard(true).players[ctx.me];
  if (mine.monsters.slice(0, 5).filter(Boolean).length > 4) return 0;
  const levels = new Map<number, number>();
  for (const code of [...(card.overlays ?? []), ...mine.grave.map(c => c.code)]) {
    if (!code) continue;
    const data = ctx.cardDb.get(code);
    const intel = readIntel(code, ctx.cardDb);
    if (!data || !intel.isMonster || intel.isXyz || intel.isLink || data.level <= 0
      || !data.setcodes.some(set => (set & 0x10ff) === 0x10db)) continue;
    levels.set(data.level, (levels.get(data.level) ?? 0) + 1);
  }
  return [...levels.values()].some(count => count >= 2) ? 2600 : 0;
}

function isExpiringSpell(card: BoardCard, ctx: BotContext): boolean {
  const effect = ctx.chainEffect;
  if (!effect || effect.player !== card.controller || effect.code !== card.code || effect.location !== card.location
    || effect.sequence !== card.sequence || card.faceDown || card.code === null) return false;
  const intel = readIntel(card.code, ctx.cardDb);
  return (intel.isSpell || intel.isTrap) && !intel.isContinuous && !intel.isField && !intel.isEquip;
}

function sacrificeValue(card: BoardCard, ctx: BotContext): number {
  return isExpiringSpell(card, ctx) ? 0 : fieldValue(card, ctx, true) - breakSwordRecovery(card, ctx);
}

function removalGain(card: BoardCard, ctx: BotContext): number {
  // Destruir uma Magia Normal encadeada não nega o efeito dela.
  return isExpiringSpell(card, ctx) ? 0 : fieldValue(card, ctx, false);
}

function ownTargets(effect: Effect, ctx: BotContext): BoardCard[] {
  return fieldCards(ctx.readBoard(true).players[ctx.me]).filter(card => {
    if (effect.code === 95169481) {
      const race = card.code ? ctx.cardDb.get(card.code)?.race ?? 0 : 0;
      return card.location === L.MZONE && !card.faceDown
        && Boolean(BigInt(race) & (OcgRace.BEAST | OcgRace.BEASTWARRIOR | OcgRace.WINGEDBEAST));
    }
    return true;
  });
}

/** null = efeito não modelado; negativo = legal, mas sem retorno demonstrável. */
export function effectValue(effect: Effect, ctx: BotContext): number | null {
  const index = indexOf(effect);
  if (readIntel(effect.code, ctx.cardDb).isSpell && ctx.readBoard(true).players[ctx.me].monsters
    .some(c => c?.code === 26964762 && !c.faceDown && !c.negated)) return -1;
  if (effect.code === 44508094 && effect.location === L.MZONE && (index === null || index === 0)
    && ctx.chainPlayer === ctx.me) return -1; // Stardust não nega nossa própria destruição.
  if (effect.code === 19613556 || effect.code === 18144506) {
    const board = ctx.readBoard(true);
    const backrow = (player: BoardPlayer) => fieldCards(player).filter(c => c.location !== L.MZONE);
    const gain = backrow(board.players[1 - ctx.me]).reduce((sum, c) => sum + removalGain(c, ctx), 0);
    const cost = effect.code === 18144506 ? 0 : backrow(board.players[ctx.me])
      .filter(c => c.location !== effect.location || c.sequence !== effect.sequence)
      .reduce((sum, c) => sum + sacrificeValue(c, ctx), 0);
    return gain > cost + 300 ? 118 : -1;
  }
  const model = removalFor(effect);
  if (model) {
    const foe = ctx.readBoard(true).players[1 - ctx.me];
    const targets = fieldCards(foe).filter(card => matches(card, model) && removalGain(card, ctx) > 0);
    if (!targets.length) return -1;
    const gain = Math.max(...targets.map(card => removalGain(card, ctx)));
    if (model.paired) {
      const costs = ownTargets(effect, ctx).map(card => sacrificeValue(card, ctx));
      if (!costs.length || gain <= Math.min(...costs) + 300) return -1;
    }
    // Duas cartas por um alvo pequeno não compensam o descarte.
    if (model.discard && targets.length === 1 && gain < 1800) return -1;
    return model.zone === "backrow" ? 58 : 122;
  }
  if (effect.code === 68464358 && effect.location === L.MZONE && (index === null || index === 0)) {
    const mine = ctx.readBoard(true).players[ctx.me];
    // O motor prova que existe Rokket no Deck. Nós precisamos provar que o
    // custo não é entregar o próprio Tuner só para trocá-lo por outro corpo.
    return fieldCards(mine).some(card => !card.faceDown && sacrificeValue(card, ctx) < 1200) ? 110 : -1;
  }
  return null;
}

/** Mantém a avaliação do custo consistente com o alvo realmente selecionado. */
export function effectTargetValue(effect: Effect, target: OcgCardLoc, ctx: BotContext): number | null {
  const model = removalFor(effect);
  const tracer = effect.code === 68464358 && (indexOf(effect) === null || indexOf(effect) === 0);
  if (!model && !tracer || target.location !== L.MZONE && target.location !== L.SZONE && target.location !== L.FZONE) return null;
  const player = ctx.readBoard(true).players[target.controller];
  const card = fieldCards(player).find(c => c.location === target.location && c.sequence === target.sequence);
  if (!card) return null;
  return target.controller === ctx.me ? -sacrificeValue(card, ctx) : removalGain(card, ctx);
}
