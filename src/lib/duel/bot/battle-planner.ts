import type { OcgMessageSelectBattleCMD } from "@n1xx1/ocgcore-wasm";
import type { BoardCard } from "@/lib/duel/board-state";
import type { BotContext } from "@/lib/duel/bot/bot-brain";
import type { BotPolicy } from "@/lib/duel/bot/difficulty";
import { appraiseAttack, battleOutcome, ownValue } from "@/lib/duel/bot/combat";
import { readIntel } from "@/lib/duel/bot/card-intel";
import { responseHypotheses } from "@/lib/duel/bot/evaluator";
import { planBattleStable } from "@/lib/duel/bot/battle-planner-stable";

interface BattleLine {
  remaining: number[];
  defenders: BoardCard[];
  score: number;
  damage: number;
  taken: number;
  certain: boolean;
  boundary: boolean;
  first: { index: number; target: BoardCard | null } | null;
}

/** Busca cooperativa; o core confirma cada ataque antes da próxima análise. */
export function planBattle(message: OcgMessageSelectBattleCMD, ctx: BotContext, policy: BotPolicy, deadline: number) {
  if (ctx.strategy === "stable") {
    const result = planBattleStable(message, ctx, policy, deadline);
    return result ? { ...result, damage: 0, lethal: "none" as const } : null;
  }
  const board = ctx.readBoard(false), mine = board.players[ctx.me], foe = board.players[1-ctx.me];
  if (policy.battleDepth === 1) return null;
  const atk = (index: number) => mine.monsters[message.attacks[index].sequence]?.attack ?? readIntel(message.attacks[index].code,ctx.cardDb).atk;
  const remaining = message.attacks.flatMap((card,index) => {
    const own = mine.monsters[card.sequence];
    // Hayabusa tem dois ataques incondicionais. Nunca projetar usos já consumidos.
    const used = ctx.attacksDeclared ? ctx.attacksDeclared[`${card.controller}:${card.location}:${card.sequence}`] ?? 0 : undefined;
    const count = card.code===21015833 && own && !own.negated && used!==undefined ? Math.max(1,2-used) : 1;
    return Array(count).fill(index) as number[];
  });
  let beam: BattleLine[] = [{remaining,defenders:foe.monsters.filter((c): c is BoardCard=>Boolean(c)),
    score:0,damage:0,taken:0,certain:true,boundary:false,first:null}];
  let best = beam[0];
  const hypotheses = responseHypotheses(ctx);
  const uncertainResponse = hypotheses.length>0 || foe.spells.some(c=>c?.faceDown);
  for(let depth=0;depth<policy.battleDepth;depth++) {
    const next: BattleLine[]=[];
    for(const line of beam) {
      if(line.boundary) continue;
      for(const index of new Set(line.remaining)) {
        // Ao menos uma alternativa é examinada mesmo sob orçamento já esgotado.
        if(performance.now()>=deadline && best.first) break;
        const attack=atk(index), own=mine.monsters[message.attacks[index].sequence];
        const targets:(BoardCard|null)[]=line.defenders.length===0 || message.attacks[index].can_direct ? [null,...line.defenders] : line.defenders;
        for(const target of targets) {
          const outcome=battleOutcome(attack,own,target);
          const totalDamage=line.damage+outcome.damage, taken=line.taken+outcome.taken;
          if(taken>=ctx.lifePoints[ctx.me]) continue;
          // Efeitos de saída não modelados são uma fronteira, não uma remoção grátis.
          const exitEffect=outcome.destroyTarget && target?.code && !target.negated && readIntel(target.code,ctx.cardDb).isEffect;
          const attackerCovered = !readIntel(message.attacks[index].code,ctx.cardDb).isEffect
            || [21015833,18036057,23205979,31305911].includes(message.attacks[index].code);
          const certain=line.certain&&!outcome.uncertain&&!exitEffect&&!uncertainResponse&&attackerCovered;
          const lethal=totalDamage>=ctx.lifePoints[1-ctx.me];
          const appraisal=target ? Math.max(appraiseAttack(attack,false,{...foe,monsters:[target]}).score,
            outcome.damage>0 ? 40+outcome.damage/25 : -Infinity) : 80+attack/20;
          const score=line.score+appraisal-(outcome.lostAttacker ? 45+(own?ownValue(own,ctx.cardDb):attack)/100 : 0)
            -outcome.taken/50-(uncertainResponse&&policy.considerResponses?attack/160:0)+(lethal?(certain?10_000:350):0);
          const rest=[...line.remaining]; rest.splice(rest.indexOf(index),1);
          const candidate: BattleLine={remaining:outcome.lostAttacker?rest.filter(i=>i!==index):rest,
            defenders:outcome.destroyTarget?line.defenders.filter(c=>c!==target):line.defenders,
            score,damage:totalDamage,taken,certain,boundary:Boolean(exitEffect)||outcome.uncertain||lethal,first:line.first??{index,target}};
          next.push(candidate); if(score>best.score) best=candidate;
        }
      }
    }
    if(!next.length||performance.now()>=deadline) break;
    next.sort((a,b)=>b.score-a.score); beam=next.slice(0,policy.battleWidth);
  }
  return best.first && best.score>0 ? {...best.first,score:best.score,damage:best.damage,
    lethal:best.damage>=ctx.lifePoints[1-ctx.me] ? best.certain?"modeled":"uncertain" : "none"} : null;
}
