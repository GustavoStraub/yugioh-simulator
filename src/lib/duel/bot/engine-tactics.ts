import { OcgLocation as L, OcgMessageType as M, SelectIdleCMDAction as A } from "@n1xx1/ocgcore-wasm";
import type { BotContext } from "@/lib/duel/bot/bot-brain";

/** Cobertura pequena e editorial; a assinatura do guia continua validando a lista. */
export const ENGINE_TACTICS = {
  "tcg-sr06": { opening:86377375, response:23898021, recovery:12766474, targets:[50383626,29424328], win:50383626 },
  "tcg-sdbt": { opening:91812341, response:6511113, recovery:45803070, targets:[91812341,82738277], win:48183890 },
  "tcg-sr14": { opening:90681088, response:18621798, recovery:3534077, targets:[69000994,18621798], win:66431519 },
  "tcg-sdcs": { opening:82562802, response:18967507, recovery:41230939, targets:[82562802,45078193], win:37542782 },
  "tcg-l26d-x-saber": { opening:5998840, response:33198837, recovery:87292536, targets:[51808422,5998840], win:52352005 },
  "tcg-sr04": { opening:44335251, response:18940556, recovery:44335251, targets:[81823360,44335251], win:18940556 },
  "tcg-sdrr": { opening:31443476, response:92892239, recovery:36668118, targets:[68464358,5969957], win:31833038 },
} as const;
export function engineTactics(id:string|null|undefined) { return id&&id in ENGINE_TACTICS?ENGINE_TACTICS[id as keyof typeof ENGINE_TACTICS]:null; }

/** Recuperação só recebe valor quando a peça está observável e a ação é legal agora. */
export function engineRecoveryValue(id:string|null|undefined,ctx:BotContext,action:number,index:number):number {
  const engine=engineTactics(id);if(!engine||ctx.prompt.type!==M.SELECT_IDLECMD)return 0;
  const card=action===A.SELECT_SUMMON?ctx.prompt.summons[index]:action===A.SELECT_ACTIVATE?ctx.prompt.activates[index]:null;
  if(card?.code!==engine.recovery)return 0;
  const mine=ctx.readBoard(true).players[ctx.me];
  const available=mine.grave.some(c=>c.code!==null&&(engine.targets as readonly number[]).includes(c.code));
  if(!available||mine.monsters.filter(Boolean).length>=4)return 0;
  if(card.code===36668118&&card.location!==L.FZONE&&card.location!==L.SZONE)return 0;
  if(card.code===44335251&&!mine.monsters.some(c=>c?.code===36042004))return 0;
  return 45;
}
