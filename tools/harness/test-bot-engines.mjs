/** Sete motores: recuperação observada e condição de vitória no core, além das aberturas em test-bot-decisions. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OcgDuelMode,OcgMessageType as M,OcgResponseType as R,OcgLocation as L,OcgPosition as P,SelectIdleCMDAction as A} from '@n1xx1/ocgcore-wasm';
import {createDuel,Zone,STOP} from './duel.mjs';
import {createBotObserver} from './bot-observer.mjs';
import {BotBrain} from '@/lib/duel/bot/bot-brain';
import {OfficialCardDb} from '@/lib/duel/official-card-data';
import {readBoardState} from '@/lib/duel/board-state';
import {getPresetDeck} from '@/lib/data/preset-decks-catalog';
import {ENGINE_TACTICS,engineRecoveryValue} from '@/lib/duel/bot/engine-tactics';
import {effectModel,interruptionValue} from '@/lib/duel/bot/effect-model';
import {botAutoResponse} from '@/lib/duel/bot-responder';
const db=new OfficialCardDb(JSON.parse(readFileSync('src/data/card-db.json','utf8')));
const recoveries=[
 {id:'tcg-sr06',hand:[12766474],grave:[50383626],zone:'hand',target:50383626},
 {id:'tcg-sdbt',hand:[45803070],grave:[91812341],zone:'monsters',target:91812341},
 {id:'tcg-sr14',hand:[3534077],grave:[69000994],zone:'monsters',target:69000994},
 {id:'tcg-sdcs',hand:[41230939],grave:[82562802],zone:'spells',target:82562802},
 {id:'tcg-l26d-x-saber',hand:[87292536],grave:[51808422],zone:'hand',target:51808422},
 {id:'tcg-sr04',hand:[44335251],grave:[81823360],field:[36042004],zone:'monsters',target:81823360},
 {id:'tcg-sdrr',hand:[],grave:[68464358],fieldSpell:36668118,foes:[89631139,89631139],zone:'monsters',target:68464358},
];
const results=[];
for(const test of recoveries){
 const deck=getPresetDeck(test.id),brain=new BotBrain({difficulty:'hard',candidateComparison:true,deck,format:'tcg',seed:31});
 const duel=await createDuel({mode:OcgDuelMode.MODE_MR5,decks:[deck.main,Array(15).fill(66602787)],startingDraw:0,place:[
   ...test.hand.map(code=>({player:0,zone:L.HAND,code})),...test.grave.map(code=>({player:0,zone:L.GRAVE,code})),
   ...(test.field??[]).map(code=>({player:0,zone:L.MZONE,code})),...(test.foes??[]).map(code=>({player:1,zone:L.MZONE,code})),
   ...(test.fieldSpell?[{player:0,zone:L.SZONE,sequence:5,position:P.FACEUP_ATTACK,code:test.fieldSpell}]:[]),...deck.extra.map(code=>({player:0,zone:L.EXTRA,code})),
 ]});
 const observe=createBotObserver(duel,'tcg');let reached=false;
 try {
  duel.run(p=>{
   const state=observe(p),me=p.player===1?1:0,board=readBoardState(duel.core,duel.handle,me);
   if(state.turnCount>1)return STOP;
   if(board.players[0][test.zone].some(c=>c?.code===test.target)){reached=true;return STOP;}
   if(me===1)return botAutoResponse(p);
   return brain.decide({...state,me,cardDb:db,readBoard:()=>board,lifePoints:duel.lifePoints});
  });
  assert.equal(duel.retriesTotal,0);assert.deepEqual(duel.errors,[]);
  if(!reached)console.log(test.id,brain.lastTrace?.observation,brain.lastTrace?.response);
  assert.ok(reached,`${test.id}: recuperação pelo core`);
  console.log(`✓ ${test.id}: recuperação confirmada no core`);
 }finally{duel.destroy();}
 // Duas ameaças com Ash: guardar num ganho baixo não impede responder à extensão principal.
 const descriptor=ENGINE_TACTICS[test.id];
 const model=effectModel(descriptor.opening,BigInt(descriptor.opening)<<20n | BigInt([90681088,82562802].includes(descriptor.opening)?1:0));
 assert.ok(model,`${test.id}: ameaça de abertura identificada`);
 const empty={monsters:Array(7).fill(null),spells:[],hand:[],grave:[],banished:[],extra:[]};
 const timing={me:0,chainPlayer:1,chainCode:descriptor.opening,chainEffect:{description:BigInt(descriptor.opening)<<20n|BigInt([90681088,82562802].includes(descriptor.opening)?1:0)},lifePoints:[8000,8000],readBoard:()=>({players:[empty,empty]})};
 assert.ok(interruptionValue({code:14558127,location:L.HAND},timing)>=60);
 const finisher=descriptor.win,atk=db.get(finisher).atk;
 const win=await createDuel({mode:OcgDuelMode.MODE_MR5,decks:[Array(15).fill(66602787),Array(15).fill(66602787)],startingDraw:0,lifePoints:[atk,8000],place:[{player:1,zone:Zone.MZONE,code:finisher}]});
 const observer=createBotObserver(win,'tcg'),pilot=new BotBrain({difficulty:'hard',candidateComparison:true,deck,format:'tcg'});
 try{
  const outcome=win.run(p=>{
   const state=observer(p),me=p.player===1?1:0;if(state.turnCount>2)return STOP;
   if(me===0&&p.type===M.SELECT_IDLECMD)return {type:R.SELECT_IDLECMD,action:A.TO_EP,index:null};
   if(me===0)return botAutoResponse(p);
   return pilot.decide({...state,me,cardDb:db,readBoard:()=>readBoardState(win.core,win.handle,me),lifePoints:win.lifePoints});
  });
  assert.equal(outcome,'WIN',`${test.id}: letal público`);assert.equal(win.winner,1);
  assert.equal(win.retriesTotal,0);assert.deepEqual(win.errors,[]);
  results.push({deck:test.id,recovery:'core',response:'directed',win:'core'});
  console.log(`✓ ${test.id}: resposta à abertura e letal confirmado no core`);
 }finally{win.destroy();}
}
console.log(JSON.stringify(results,null,2));
