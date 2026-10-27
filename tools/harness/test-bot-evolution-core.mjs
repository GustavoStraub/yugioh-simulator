/** Confronta previsões cobertas com a execução dos mesmos efeitos no core. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OcgMessageType as M, OcgResponseType as R, OcgPosition as P, SelectIdleCMDAction as A, SelectBattleCMDAction as B } from '@n1xx1/ocgcore-wasm';
import { createDuel, Zone, STOP } from './duel.mjs';
import { createBotObserver } from './bot-observer.mjs';
import { readBoardState } from '@/lib/duel/board-state';
import { OfficialCardDb } from '@/lib/duel/official-card-data';
import { botAutoResponse } from '@/lib/duel/bot-responder';
import { battleOutcome } from '@/lib/duel/bot/combat';
import { planBattle } from '@/lib/duel/bot/battle-planner';
import { BOT_POLICIES } from '@/lib/duel/bot/difficulty';
const db=new OfficialCardDb(JSON.parse(readFileSync('src/data/card-db.json','utf8')));
for(const [attacker,defender,lp] of [[89631139,23205979,8000],[89631139,31305911,8000],[21015833,null,1500],[18036057,5053103,800]]) {
  const duel=await createDuel({decks:[Array(10).fill(66602787),Array(10).fill(66602787)],lifePoints:[lp,8000],
    place:[{player:1,zone:Zone.MZONE,code:attacker},...(defender?[{player:0,zone:Zone.MZONE,code:defender,position:P.FACEUP_DEFENSE}]:[])]});
  const observer=createBotObserver(duel,'goat');let prediction=null,attacks=0,battlePrompts=0;
  try {
    const outcome=duel.run(p=>{
      const state=observer(p);
      if(state.turnCount>2) return STOP;
      if(p.type===M.SELECT_IDLECMD) return {type:R.SELECT_IDLECMD,action:p.player===1&&p.to_bp?A.TO_BP:A.TO_EP,index:null};
      if(p.type===M.SELECT_BATTLECMD) {
        battlePrompts++;
        if(!prediction) {
          const board=readBoardState(duel.core,duel.handle,1);
          prediction=planBattle(p,{...state,me:1,readBoard:()=>board,cardDb:db,lifePoints:duel.lifePoints},BOT_POLICIES.hard,performance.now()+100);
          if(defender===23205979||defender===31305911) {
            assert.equal(battleOutcome(board.players[1].monsters[0].attack,board.players[1].monsters[0],board.players[0].monsters[0]).destroyTarget,false);
          }
        }
        if(p.attacks.length) {attacks++;return {type:R.SELECT_BATTLECMD,action:B.SELECT_BATTLE,index:0};}
        return {type:R.SELECT_BATTLECMD,action:p.to_m2?B.TO_M2:B.TO_EP,index:null};
      }
      return botAutoResponse(state.prompt);
    });
    assert.ok(battlePrompts,'cenário chegou à batalha');
    assert.equal(duel.retriesTotal,0);assert.deepEqual(duel.errors,[]);
    const board=readBoardState(duel.core,duel.handle,1);
    if(defender===23205979||defender===31305911) {
      assert.ok(board.players[0].monsters.some(c=>c?.code===defender),'proteção observada no core');
      assert.equal(prediction,null,'não projeta remoção nem letal através da proteção');
    } else {
      assert.equal(outcome,'WIN');assert.equal(duel.winner,1);
      assert.equal(prediction.lethal,'modeled');
      assert.equal(prediction.damage,attacker===21015833?2000:900);
      if(attacker===21015833) assert.equal(attacks,2,'dois ataques confirmados pelo core');
    }
    console.log(`✓ previsão/core: ${attacker} × ${defender??'campo vazio'}`);
  } finally {duel.destroy();}
}
