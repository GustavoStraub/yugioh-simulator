import type { OcgMessageSelectBattleCMD } from "@n1xx1/ocgcore-wasm";
import type { BoardCard } from "@/lib/duel/board-state";
import type { BotContext } from "@/lib/duel/bot/bot-brain";
import type { BotPolicy } from "@/lib/duel/bot/difficulty";
import { ASSUMED_SET_DEFENSE, appraiseAttack, knownStats, ownValue } from "@/lib/duel/bot/combat";
import { readIntel } from "@/lib/duel/bot/card-intel";

interface BattleLine {
  remaining: number[];
  defenders: BoardCard[];
  score: number;
  damage: number;
  loss: number;
  first: { index: number; target: BoardCard | null } | null;
}

/** Busca limitada de ordens de ataque; recalcule após CADA resposta do core. */
export function planBattleStable(message: OcgMessageSelectBattleCMD, ctx: BotContext, policy: BotPolicy, deadline: number) {
  const board = ctx.readBoard(false);
  const mine = board.players[ctx.me];
  const foe = board.players[1 - ctx.me];
  if (policy.battleDepth === 1) return null;
  const atk = (i: number) => {
    const card = message.attacks[i];
    return mine.monsters[card.sequence]?.attack ?? readIntel(card.code, ctx.cardDb).atk;
  };
  let beam: BattleLine[] = [{ remaining: message.attacks.map((_, i) => i),
    defenders: foe.monsters.filter((c): c is BoardCard => c !== null), score: 0, damage: 0, loss: 0, first: null }];
  let best = beam[0];
  const hiddenResponse = policy.considerResponses && foe.spells.some((c) => c?.faceDown);
  for (let depth = 0; depth < policy.battleDepth && performance.now() < deadline; depth += 1) {
    const next: BattleLine[] = [];
    for (const line of beam) for (const index of line.remaining) {
      if (performance.now() >= deadline) break;
      const attack = atk(index);
      const targets: (BoardCard | null)[] = line.defenders.length === 0 || message.attacks[index].can_direct
        ? [null, ...line.defenders] : line.defenders;
      for (const target of targets) {
        const stats = target ? knownStats(target) : null;
        const power = target ? stats ? target.defense ? stats.defense : stats.attack : ASSUMED_SET_DEFENSE : 0;
        const damage = !target ? attack : !target.defense && stats ? Math.max(0, attack - power) : 0;
        const lost = Boolean(target && !target.defense && stats && attack <= power);
        const destroyed = Boolean(target && stats && (target.defense ? attack > power : attack >= power));
        const ownCard = mine.monsters[message.attacks[index].sequence];
        const appraisal = target ? appraiseAttack(attack, false, { ...foe, monsters: [target] }, false).score : 80 + attack / 20;
        const loss = line.loss + (lost ? ownCard ? ownValue(ownCard, ctx.cardDb) : attack : 0);
        const totalDamage = line.damage + damage;
        const lethal = totalDamage >= ctx.lifePoints[1 - ctx.me];
        const score = line.score + appraisal - (lost ? 45 : 0) - (hiddenResponse ? attack / 160 : 0)
          + (lethal && !hiddenResponse ? 10_000 : 0) - (loss > 0 && !lethal ? 10 : 0);
        const candidate: BattleLine = { remaining: line.remaining.filter((i) => i !== index),
          defenders: destroyed ? line.defenders.filter((c) => c !== target) : line.defenders,
          score, damage: totalDamage, loss, first: line.first ?? { index, target } };
        next.push(candidate);
        if (candidate.score > best.score) best = candidate;
      }
    }
    if (!next.length) break;
    next.sort((a, b) => b.score - a.score);
    beam = next.slice(0, policy.battleWidth);
  }
  return best.first && best.score > 0 ? { ...best.first, score: best.score } : null;
}
