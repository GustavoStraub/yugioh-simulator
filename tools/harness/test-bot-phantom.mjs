/** O cérebro executa as lições sem uma política externa escolher os comandos. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OcgDuelMode,OcgMessageType as M,OcgLocation as L,OcgPosition as P,SelectIdleCMDAction as A} from '@n1xx1/ocgcore-wasm';
import {BotBrain} from '@/lib/duel/bot/bot-brain';
import {OfficialCardDb} from '@/lib/duel/official-card-data';
import {readBoardState} from '@/lib/duel/board-state';
import {getPresetDeck} from '@/lib/data/preset-decks-catalog';
import {getDeckGuide} from '@/lib/data/deck-guides';
import {createDuel,STOP} from './duel.mjs';
import {createBotObserver} from './bot-observer.mjs';
import {botAutoResponse} from '@/lib/duel/bot-responder';

const deck=getPresetDeck('tcg-lehd-phantom-knights'),foe=getPresetDeck('tcg-sdk');
const db=new OfficialCardDb(JSON.parse(readFileSync('src/data/card-db.json','utf8')));
const BLUE=89631139;
const C={cloak:90432163,boots:36426778,gloves:63821877,sword:62709239,rusty:26692769,fog:25542642,wing:98431356,rebellion:16195942,requiem:1621413,launch:3298689,shade:98827725,arma:28985331,nightmare:359563,ferret:56343672,vambrace:36247316,javelin:12219047};

const grave=code=>({player:0,zone:L.GRAVE,code});
const set=code=>({player:0,zone:L.SZONE,sequence:0,position:P.FACEDOWN,code});

const field=(code,player=0,sequence=0)=>({player,zone:L.MZONE,code,sequence});
const rusty=field(C.rusty,0,5);
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
  const lessons=new Set(getDeckGuide('herois-lendarios-cavaleiros-fantasmas').lessons.map(l=>l.id));
  assert.ok(traces.every(t=>!t.guideLesson||lessons.has(t.guideLesson)),'cada decisão aponta para uma lição real');
  const raw=readBoardState(duel.core,duel.handle,seat),board=seat===0?raw:{...raw,players:[raw.players[1],raw.players[0]]};
  check?.(board,traces,duel);
  console.log(`✓ bot Phantom: ${id}`);return {board,traces};
 }catch(error){console.log(traces.filter(t=>t.source!=='automatic').map(t=>({prompt:t.prompt,response:t.response,lesson:t.guideLesson,why:t.reason,fallback:t.fallback,cards:t.observation.prompt.selects?.map(c=>[c.code,c.controller,c.location])})));throw error;}
 finally{duel.destroy();}
}
const activated=(trace,code)=>trace.some(t=>t.prompt===M.SELECT_IDLECMD&&t.response.action===A.SELECT_ACTIVATE
 &&t.observation.prompt.activates[t.response.index]?.code===code);
const inField=(board,code)=>board.players[0].monsters.some(c=>c?.code===code);



await play('Espada abre Classe 4 e Launch chega a Réquiem',[C.cloak,C.boots,C.launch,83764718,98153934],[field(BLUE,1),field(5053103,1,1)],{
 until:ctx=>ctx.prompt.type===M.SELECT_IDLECMD&&ctx.readBoard(true).players[0].monsters.some(c=>c?.code===C.requiem&&(c.attack??0)>3000&&c.overlays.length===1),
 check:b=>{assert.ok(inField(b,C.requiem));assert.deepEqual(b.players[0].monsters.find(c=>c?.code===C.requiem).overlays,[C.rebellion]);}
});
await play('Bardiche transforma a própria Espada em dois Níveis 4',[C.cloak,C.boots,98153934,61936647,61936647],[rusty],{
 until:ctx=>ctx.prompt.type===M.SELECT_IDLECMD&&ctx.readBoard(true).players[0].monsters.some(c=>c?.code===C.nightmare),
 check:b=>{assert.ok(inField(b,C.rusty));assert.ok(inField(b,C.nightmare));assert.ok(b.players[0].grave.some(c=>c.code===C.sword));}
});
await play('Furão respeita as duas setas e gera remoção',[C.ferret,98153934,61936647,61936647,77462146],[rusty,field(BLUE,1)],{
 until:ctx=>ctx.prompt.type===M.SELECT_IDLECMD&&ctx.readBoard(true).players[1].grave.some(c=>c.code===BLUE),
 check:(b,t)=>{assert.ok(activated(t,C.ferret));assert.ok(b.players[1].grave.some(c=>c.code===BLUE));assert.ok(inField(b,C.sword));}
});
await play('Lâmina no Cemitério recupera o alvo antes de uma busca',[C.boots,98153934,61936647,61936647,77462146],[grave(C.cloak),grave(C.fog)],{
 until:ctx=>ctx.prompt.type===M.SELECT_IDLECMD&&ctx.readBoard(true).players[0].monsters.some(c=>c?.code===C.sword),
 check:b=>{assert.ok(inField(b,C.sword));assert.ok(b.players[0].banished.some(c=>c.code===C.fog));}
});
await play('Brigandina e Armagedom formam Pesadelo',[C.arma,C.shade,98153934,61936647,77462146],[],{
 until:ctx=>ctx.prompt.type===M.SELECT_IDLECMD&&ctx.readBoard(true).players[0].monsters.some(c=>c?.code===C.nightmare),
 check:b=>assert.ok(inField(b,C.nightmare))
});
await play('Lâmina nega o monstro adversário',[C.cloak,98153934,61936647,61936647,77462146],[set(C.fog),field(6285791,1)],{
 until:ctx=>ctx.prompt.type===M.SELECT_IDLECMD&&ctx.readBoard(true).players[1].monsters.some(c=>c?.code===6285791&&c.negated),
 check:b=>assert.ok(b.players[1].monsters.some(c=>c?.code===6285791&&c.negated))
});
await play('Manopla abre Lança Amaldiçoada',[C.cloak,98153934,61936647,61936647,77462146],[set(C.vambrace),field(BLUE,1)],{
 until:ctx=>ctx.prompt.type===M.SELECT_IDLECMD&&ctx.readBoard(true).players[0].monsters.some(c=>c?.code===C.javelin),
 check:b=>assert.ok(inField(b,C.javelin))
});
await play('Launch do Cemitério recarrega Pesadelo',[C.boots,98153934,61936647,61936647,77462146],[field(C.nightmare),grave(C.launch),field(BLUE,1)],{
 until:ctx=>ctx.prompt.type===M.SELECT_IDLECMD&&ctx.readBoard(true).players[0].monsters.some(c=>c?.code===C.nightmare&&c.overlays.includes(C.boots)),
 check:b=>assert.ok(b.players[0].monsters.some(c=>c?.code===C.nightmare&&c.overlays.includes(C.boots)))
});
await play('Espada apenas colocada no campo não tem recuperação presumida',[98153934,61936647,61936647,77462146,77462146],[field(C.sword),grave(C.cloak),grave(C.boots),field(BLUE,1)],{
 check:(b,t)=>{assert.ok(!activated(t,C.sword));}
});

await play('Luvas dá 3000 ATK à Espada no segundo assento',[C.gloves,C.boots,98153934,61936647,77462146],[],{
 seat:1,until:ctx=>ctx.prompt.type===M.SELECT_IDLECMD&&ctx.readBoard(true).players[1].monsters.some(c=>c?.code===C.sword&&c.attack===3000),
 check:b=>assert.ok(b.players[0].monsters.some(c=>c?.code===C.sword&&c.attack===3000))
});
await play('Brigandina não ganha exceção com Armadilha no Cemitério',[C.arma,C.shade,98153934,61936647,77462146],[grave(C.wing)],{
 check:(b,t)=>assert.ok(!activated(t,C.shade))
});
await play('Furão fica na mão quando Bardiche não oferece duas setas',[C.ferret,98153934,61936647,61936647,77462146],[field(C.rusty)],{
 check:(b,t)=>{assert.ok(b.players[0].hand.some(c=>c.code===C.ferret));assert.ok(!activated(t,C.ferret));}
});

// Same session/profile/worker path used by the application, with no scripted bot answers.
{
 const {createDuelSession}=await import('@/lib/duel/duel-session');
 const {CardRegistry}=await import('@/lib/domain/card-registry');
 const {nodeAssets}=await import('@/server/duel/node-assets');
 const registry=CardRegistry.fromCatalog(JSON.parse(readFileSync('.cache/catalog/catalog.json','utf8')));
 const session=createDuelSession(),traces=[];let reached=false;
 const opponent={...foe,main:foe.main.filter(c=>c!==BLUE&&c!==5053103)};
 try{
 await session.start({playerName:'Cavaleiros',playerDeck:deck,opponentName:'Parceiro',opponentDeck:opponent,format:'tcg',registry,assets:nodeAssets,pace:0,cutIns:false,watchSeat:0,testSeed:73,
 openingHands:[[C.cloak,C.boots,C.launch,83764718,98153934],opponent.main.slice(0,5)],
 scenario:[{player:1,location:L.MZONE,sequence:0,code:BLUE},{player:1,location:L.MZONE,sequence:1,code:5053103}],
 seats:[{kind:'bot',name:'Cavaleiros',bot:{difficulty:'hard',execution:'worker',candidateComparison:true,onDecision(t){traces.push(t);if(traces.length>180)throw Error('sequência excessiva');if(session.core&&t.prompt===M.SELECT_IDLECMD){const b=readBoardState(session.core,session.handle,0);if(b.players[0].monsters.some(c=>c?.code===C.requiem&&c.overlays.includes(C.rebellion))){reached=true;session.dispose();}}}}},{kind:'local',name:'Parceiro'}]});
 assert.ok(reached,'worker executa Espada → Rebelião → Réquiem');assert.ok(traces.some(t=>t.capabilities.phantomStrategy));assert.ok(traces.every(t=>t.source!=='fallback-error'&&t.source!=='rejected-recovery'));console.log('✓ DuelSession + worker: política, perfil histórico e subida até Réquiem');
 }finally{session.dispose();}
}
