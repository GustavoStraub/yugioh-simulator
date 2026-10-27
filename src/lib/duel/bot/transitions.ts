import { OcgLocation as L, OcgMessageType as M, OcgType } from "@n1xx1/ocgcore-wasm";
import type { BotContext } from "@/lib/duel/bot/bot-brain";
import type { BotCondition, BotDeckProfile, BotRoute, BotStep, BotZone } from "@/lib/duel/bot/deck-profile";
import { remainingInDeck } from "@/lib/duel/bot/deck-profile";
import type { DuelDeckPayload } from "@/lib/types";
import { readIntel } from "@/lib/duel/bot/card-intel";

export interface BotTransition {
  id:string;route:string;index:number;objective:string;step:BotStep;next:string[];
}
export interface PlanningResources {
  zones:Record<BotZone|"deck"|"overlay",Map<number,number>>;
  normal:"available"|"spent"|"unknown";
  effectsUsed:Set<string>;restrictions:Set<string>;
}
export interface TransitionLine { steps:string[];boundary:"unknown-effect"|"resource"|"complete"|"budget"; projected:boolean }

export function compileTransitions(profile:BotDeckProfile):Map<string,BotTransition> {
  const transitions=new Map<string,BotTransition>();
  for(const route of profile.routes)for(const [index,step]of route.steps.entries())transitions.set(step.id,{
    id:step.id,route:route.id,index,objective:route.objective,step,next:route.steps[index+1]?[route.steps[index+1].id]:[],
  });
  const successors=new Map([...transitions].map(([id,node])=>[id,[...node.next]]));
  for(const node of transitions.values())if(node.step.completeWhen.length){
    const signature=JSON.stringify(node.step.completeWhen);
    for(const other of transitions.values())if(other.id!==node.id&&JSON.stringify(other.step.completeWhen)===signature)
      node.next.push(...(successors.get(other.id)??[]).filter(id=>id!==node.id&&!node.next.includes(id)));
  }
  return transitions;
}

export function planningResources(ctx:BotContext,deck:DuelDeckPayload):PlanningResources {
  const mine=ctx.readBoard(true).players[ctx.me];
  const zones={} as PlanningResources["zones"];
  for(const zone of ["hand","monsters","spells","grave","banished","extra"] as const){
    zones[zone]=new Map();for(const card of mine[zone])if(card?.code)zones[zone].set(card.code,(zones[zone].get(card.code)??0)+1);
  }
  zones.deck=new Map([...new Set(deck.main)].map(code=>[code,remainingInDeck(deck,mine,code)]));zones.overlay=new Map();
  return {zones,normal:ctx.prompt.type===M.SELECT_IDLECMD&&ctx.prompt.summons.length?"available":ctx.turnResources?.normalUsed?"spent":"unknown",
    effectsUsed:new Set(ctx.turnResources?.effectsUsed??[]),restrictions:new Set(ctx.turnResources?.restrictions??[])};
}

function projectedMove(state:PlanningResources,code:number,from:keyof PlanningResources["zones"],to:keyof PlanningResources["zones"]):boolean {
  const n=state.zones[from].get(code)??0;if(!n)return false;
  state.zones[from].set(code,n-1);state.zones[to].set(code,(state.zones[to].get(code)??0)+1);return true;
}

/** Apenas movimentos determinísticos já cobertos; efeitos desconhecidos encerram a linha. */
export function projectTransition(transition:BotTransition,before:PlanningResources,ctx:BotContext):PlanningResources|null {
  const step=transition.step,action=step.action;
  if(!action||action.kind==="activates")return null;
  const after:PlanningResources={zones:Object.fromEntries(Object.entries(before.zones).map(([zone,cards])=>[zone,new Map(cards)])) as PlanningResources["zones"],
    normal:before.normal,effectsUsed:new Set(before.effectsUsed),restrictions:new Set(before.restrictions)};
  const intel=readIntel(action.code,ctx.cardDb);
  if(action.kind==="summons"){
    if(before.normal!=="available"||intel.tributes>0)return null;
    // Não pressupor que um gatilho (Kagemucha, por exemplo) resolveu junto.
    if(step.completeWhen.some(c=>c.kind!=="card"||c.code!==action.code||c.zone!=="monsters"))return null;
    if(!projectedMove(after,action.code,"hand","monsters"))return null;
    after.normal="spent";return after;
  }
  if((before.zones.hand.get(action.code)??0)>0){
    if(action.code!==36426778)return null; // Botas, com Cavaleiro já presente.
    if(![90432163,63821877,99315585,36704180].some(code=>(before.zones.monsters.get(code)??0)>0))return null;
    return projectedMove(after,action.code,"hand","monsters")?after:null;
  }
  if(!(before.zones.extra.get(action.code)??0))return null;
  if(before.restrictions.has("fusion-only")&&!(intel.type&OcgType.FUSION))return null;
  if(before.restrictions.has("dark-only")&&ctx.cardDb.get(action.code)?.attribute!==32)return null;
  const materials=step.targets.filter(t=>t.location===L.MZONE&&t.scope!=="action");
  if(!materials.length)return null;
  for(const card of materials)if(!projectedMove(after,card.code,"monsters",intel.isXyz?"overlay":"grave"))return null;
  return projectedMove(after,action.code,"extra","monsters")?after:null;
}

/** Inclui parar e prefixos; a projeção nunca cria um índice de resposta futura. */
export function transitionLines(route:BotRoute,entry:number,resources:PlanningResources,ctx:BotContext,deadline:number,depth=3):TransitionLine[] {
  const result:TransitionLine[]=[{steps:[],boundary:"complete",projected:false}];
  let state=resources;const steps:string[]=[];
  for(let i=entry;i<route.steps.length&&steps.length<depth;i++){
    if(performance.now()>=deadline){result.push({steps:[...steps],boundary:"budget",projected:steps.length>0});break;}
    const transition:BotTransition={id:route.steps[i].id,route:route.id,index:i,objective:route.objective,step:route.steps[i],next:[]};
    const projected=projectTransition(transition,state,ctx);
    if(!projected){result.push({steps:[...steps,transition.id],boundary:"unknown-effect",projected:false});break;}
    steps.push(transition.id);state=projected;result.push({steps:[...steps],boundary:i===route.steps.length-1?"complete":"resource",projected:true});
  }
  return result;
}

export function confirmedTransition(conditions:readonly BotCondition[],ctx:BotContext):boolean {
  const mine=ctx.readBoard(true).players[ctx.me];
  return conditions.length>0&&conditions.every(c=>c.kind==="card"?(c.absent?!mine[c.zone].some(x=>x?.code===c.code):mine[c.zone].filter(x=>x?.code===c.code).length>=(c.count??1))
    :c.kind==="lp"?ctx.lifePoints[c.player===0?ctx.me:1-ctx.me]===c.value:false);
}
