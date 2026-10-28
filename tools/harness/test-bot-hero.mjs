/** O cérebro executa as lições sem uma política externa escolher os comandos. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OcgDuelMode,OcgMessageType as M,OcgLocation as L,SelectIdleCMDAction as A} from '@n1xx1/ocgcore-wasm';
import {BotBrain} from '@/lib/duel/bot/bot-brain';
import {OfficialCardDb} from '@/lib/duel/official-card-data';
import {readBoardState} from '@/lib/duel/board-state';
import {getPresetDeck} from '@/lib/data/preset-decks-catalog';
import {getDeckGuide} from '@/lib/data/deck-guides';
import {createDuel,STOP} from './duel.mjs';
import {createBotObserver} from './bot-observer.mjs';
import {botAutoResponse} from '@/lib/duel/bot-responder';

const deck=getPresetDeck('tcg-lehd-destiny-hero'),foe=getPresetDeck('tcg-sdk');
const db=new OfficialCardDb(JSON.parse(readFileSync('src/data/card-db.json','utf8')));
const BLUE=89631139;
const field=(code,player=0,sequence=0)=>({player,zone:L.MZONE,code,sequence});
function remove(list,placed,seat) {
 const main=[...list];for(const card of placed.filter(c=>c.player===seat&&c.zone!==L.EXTRA)){
  if(list===deck.main&&deck.extra.includes(card.code))continue;
  const i=main.indexOf(card.code);assert.ok(i>=0,`quantidade real ${card.code}`);main.splice(i,1);
 }return main;
}
async function play(id,hand,scenario=[],{check,config={},until,seat=0}={}) {
 const placed=[...hand.map(code=>({player:0,zone:L.HAND,code})),...scenario].map(c=>({...c,player:seat===0?c.player:1-c.player})),traces=[];
 const brain=new BotBrain({deck,format:'tcg',seed:31,candidateComparison:true,...config,onDecision:t=>traces.push(t)});
 const lists=seat===0?[deck,foe]:[foe,deck];
 const duel=await createDuel({mode:OcgDuelMode.MODE_MR5,seed:73n,decks:lists.map((d,i)=>remove(d.main,placed,i)),place:[...placed,...deck.extra.filter((code,i,all)=>!placed.some(c=>c.player===seat&&c.code===code)||all.indexOf(code)!==i).map(code=>({player:seat,zone:L.EXTRA,code}))]});
 const observe=createBotObserver(duel,'tcg');
 try {
  const result=duel.run(prompt=>{
   const state=observe(prompt),me=prompt.player===1?1:0;
   if(me!==seat&&prompt.type===M.SELECT_IDLECMD&&traces.length)return STOP;
   if(me!==seat)return botAutoResponse(prompt);
   if(state.turnCount>(seat===0?1:2)||traces.length>160)return STOP;
   const ctx={...state,me,cardDb:db,readBoard:full=>readBoardState(duel.core,duel.handle,me,!full),lifePoints:duel.lifePoints};
   if(until?.(ctx,duel,traces))return STOP;
   return brain.decide(ctx);
  });
  assert.equal(result,'STOPPED',id);assert.equal(duel.retriesTotal,0,`${id}: sem RETRY`);assert.deepEqual(duel.errors,[],id);
  assert.ok(traces.every(t=>t.source!=='fallback-error'&&t.source!=='rejected-recovery'),`${id}: sem recuperação de erro`);
  const lessons=new Set(getDeckGuide('herois-lendarios-destiny-hero').lessons.map(l=>l.id));
  assert.ok(traces.every(t=>!t.guideLesson||lessons.has(t.guideLesson)),'cada decisão aponta para uma lição real');
  const raw=readBoardState(duel.core,duel.handle,seat),board=seat===0?raw:{...raw,players:[raw.players[1],raw.players[0]]};
  check?.(board,traces,duel);
  console.log(`✓ bot HERO: ${id}`);return {board,traces};
 }catch(error){console.log(traces.filter(t=>t.source!=='automatic').map(t=>({prompt:t.prompt,response:t.response,lesson:t.guideLesson,why:t.reason,fallback:t.fallback,cards:t.observation.prompt.selects?.map(c=>[c.code,c.controller,c.location])})));throw error;}
 finally{duel.destroy();}
}
const activated=(trace,code)=>trace.some(t=>t.prompt===M.SELECT_IDLECMD&&t.response.action===A.SELECT_ACTIVATE
 &&t.observation.prompt.activates[t.response.index]?.code===code);
const inField=(board,code)=>board.players[0].monsters.some(c=>c?.code===code);


await play('Sacar o Destino descarta Malicioso e desenvolve', [45809008,9411399,63060238,75041269,35787450],[],{
 until:ctx=>ctx.prompt.type===M.SELECT_IDLECMD&&ctx.readBoard(true).players[0].monsters.some(c=>c?.code===9411399),
 check:(b,t)=>{assert.ok(activated(t,45809008));assert.ok(inField(b,9411399));assert.ok(b.players[0].banished.some(c=>c.code===9411399));}
});
await play('Dinatag habilita Distopia contra ameaça adversária', [98494543,75041269,35787450,35787450,73628505],[field(90579153),{player:0,zone:L.GRAVE,code:37780349},{player:0,zone:L.GRAVE,code:63362460},field(BLUE,1)],{
 until:ctx=>ctx.prompt.type===M.SELECT_IDLECMD&&ctx.readBoard(true).players[1].grave.some(c=>c.code===BLUE),
 check:(b,t)=>{assert.ok(t.some(t=>t.guideLesson==='dynatag-habilita-a-destruicao-de-dystopia'));assert.ok(b.players[1].grave.some(c=>c.code===BLUE));assert.ok(inField(b,90579153));}
});
await play('Distopia não destrói cartas próprias sem alvo adversário', [75041269,35787450,35787450,73628505,73628505],[field(90579153),{player:0,zone:L.GRAVE,code:37780349}],{
 check:(b,t)=>{assert.ok(!activated(t,90579153));assert.ok(inField(b,90579153));}
});
await play('Perigoso envia Malicioso do Deck', [35787450,75041269,73628505,73628505,98494543],[field(30757127)],{
 until:ctx=>ctx.prompt.type===M.SELECT_IDLECMD&&ctx.readBoard(true).players[0].monsters.some(c=>c?.code===9411399),
 check:(b,t)=>{assert.ok(t.some(t=>t.guideLesson==='perigoso-prepara-malicioso')); assert.ok(inField(b,9411399));}
});
await play('Além do Destino vem antes do banimento de Malicioso', [72204747,83965310,75041269,35787450,35787450],[field(90579153),{player:0,zone:L.GRAVE,code:9411399},field(BLUE,1)],{
 until:ctx=>ctx.prompt.type===M.SELECT_IDLECMD&&ctx.readBoard(true).players[0].monsters.some(c=>c?.code===83965310),
 check:(b,t)=>{assert.ok(activated(t,72204747));assert.ok(inField(b,83965310));}
});
await play('Homem em Chamas encontra Polimerização e faz Distopia',[63060238,63362460,9411399,83764718,75041269],[],{
 until:ctx=>ctx.prompt.type===M.SELECT_IDLECMD&&ctx.readBoard(true).players[0].monsters.some(c=>c?.code===90579153),
 check:(b,t)=>{assert.ok(inField(b,90579153));}
});
await play('Névoa Normal transforma e busca outro HERO',[50720316,21143940,75041269,35787450,35787450],[],{
 until:ctx=>ctx.prompt.type===M.SELECT_IDLECMD&&ctx.readBoard(true).players[0].monsters.some(c=>c?.code===58481572),
 check:b=>{assert.ok(inField(b,58481572));assert.ok(b.players[0].hand.some(c=>c.code===63060238||c.code===91691605));}
});
await play('Máscara também funciona no segundo assento',[50720316,21143940,75041269,35787450,35787450],[],{
 seat:1,until:ctx=>ctx.prompt.type===M.SELECT_IDLECMD&&ctx.readBoard(true).players[1].monsters.some(c=>c?.code===58481572),
 check:b=>assert.ok(inField(b,58481572))
});
await play('Envio de Névoa transforma Homem em Chamas em TREVAS',[63060238,21143940,24094653,75041269,35787450],[],{
 until:ctx=>ctx.prompt.type===M.SELECT_IDLECMD&&ctx.readBoard(true).players[0].monsters.some(c=>c?.code===58481572),
 check:b=>assert.ok(inField(b,58481572))
});
