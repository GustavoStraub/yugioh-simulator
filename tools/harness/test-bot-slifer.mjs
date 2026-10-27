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
import {BotKnowledge} from '@/lib/duel/bot/knowledge';
import {createDuelSession} from '@/lib/duel/duel-session';
import {CardRegistry} from '@/lib/domain/card-registry';
import {nodeAssets} from '@/server/duel/node-assets';

const deck=getPresetDeck('tcg-egs1'),foe=getPresetDeck('tcg-sdk');
const db=new OfficialCardDb(JSON.parse(readFileSync('src/data/card-db.json','utf8')));
const C={S:10000020,AH:86377375,LAIR:59160188,CROSS:5253985,REACTOR:79387392,ADVANCE:52112003,NAME:39913299,
 THUNDER:42469671,SKY:12958919,PASS:93104632,VISHUDA:23431858,CONTROL:98045062,MARCH:19870120,DUKE:12766474,
 GREED:37576645,REBORN:83764718,GUARD:4694209,FRONT:59919307};
const BLUE=89631139,OX=5053103;
const field=(code,player=0,sequence=0)=>({player,zone:L.MZONE,code,sequence});
const lair={player:0,zone:L.SZONE,sequence:5,position:P.FACEUP_ATTACK,code:C.LAIR};
function remove(list,placed,seat) {
 const main=[...list];for(const card of placed.filter(c=>c.player===seat)){
  const i=main.indexOf(card.code);assert.ok(i>=0,`quantidade real ${card.code}`);main.splice(i,1);
 }return main;
}
async function play(id,hand,scenario=[],{check,config={},until,seat=0}={}) {
 const placed=[...hand.map(code=>({player:0,zone:L.HAND,code})),...scenario].map(c=>({...c,player:seat===0?c.player:1-c.player})),traces=[];
 const brain=new BotBrain({deck,format:'tcg',seed:31,...config,onDecision:t=>traces.push(t)});
 const lists=seat===0?[deck,foe]:[foe,deck];
 const duel=await createDuel({mode:OcgDuelMode.MODE_MR5,seed:73n,decks:lists.map((d,i)=>remove(d.main,placed,i)),place:placed});
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
  const lessons=new Set(getDeckGuide('tcg-egs1').lessons.map(l=>l.id));
  assert.ok(traces.every(t=>!t.guideLesson||lessons.has(t.guideLesson)),'cada decisão aponta para uma lição real');
  const raw=readBoardState(duel.core,duel.handle,seat),board=seat===0?raw:{...raw,players:[raw.players[1],raw.players[0]]};
  check?.(board,traces,duel);
  console.log(`✓ bot Slifer: ${id}`);return {board,traces};
 }catch(error){console.log(traces.filter(t=>t.source!=='automatic').map(t=>({prompt:t.prompt,response:t.response,lesson:t.guideLesson,why:t.reason,fallback:t.fallback,cards:t.observation.prompt.selects?.map(c=>[c.code,c.controller,c.location])})));throw error;}
 finally{duel.destroy();}
}
const activated=(trace,code)=>trace.some(t=>t.prompt===M.SELECT_IDLECMD&&t.response.action===A.SELECT_ACTIVATE
 &&t.observation.prompt.activates[t.response.index]?.code===code);
const inField=(board,code)=>board.players[0].monsters.some(c=>c?.code===code);

await play('Ahrima busca Covil e tributa o adversário preservando o próprio corpo',
 [C.AH,C.AH,C.S,C.THUNDER,C.GREED],[field(BLUE,1)],{
 check:(b,t)=>{assert.equal(b.players[0].field?.code,C.LAIR);assert.ok(inField(b,C.AH));assert.ok(b.players[1].grave.some(c=>c.code===BLUE));
  assert.ok(t.some(t=>t.guideLesson==='ahrima-tributa-o-adversario'));}
});
await play('Reator e Avanço executam a Invocação-Tributo sem gastar a mão à toa',
 [C.REACTOR,C.ADVANCE,C.S,C.THUNDER,C.MARCH],[],{
 check:(b,t)=>{assert.ok(inField(b,C.S));assert.ok(activated(t,C.ADVANCE));assert.ok(b.players[0].hand.length>=2);}
});
await play('Ficha antes de Skyblaster e Invocação-Tributo com um corpo restante',
 [C.PASS,C.SKY,C.ADVANCE,C.S,C.THUNDER],[],{
 check:b=>{assert.ok(inField(b,C.S));assert.equal(b.players[0].monsters.filter(Boolean).length,2);}
});
await play('Cruzar Almas remove três adversários e resolve Slifer',
 [C.CROSS,C.S,C.THUNDER,C.ADVANCE,C.MARCH],[field(BLUE,1),field(OX,1,1),field(76184692,1,2)],{
 check:(b,t)=>{assert.ok(inField(b,C.S));assert.equal(b.players[1].monsters.filter(Boolean).length,0);assert.ok(activated(t,C.CROSS));}
});
await play('Avanço, declaração conhecida, busca do Deus e Reator completam a linha',
 [C.ADVANCE,C.NAME,C.REACTOR,C.THUNDER,C.GREED],[],{
 check:(b,t)=>{assert.ok(activated(t,C.NAME));assert.ok(inField(b,C.S));assert.ok(t.some(t=>t.prompt===M.ANNOUNCE_CARD&&t.guideLesson==='avanco-e-o-nome-verdadeiro'));}
});
await play('O Nome Verdadeiro fica na mão sem informação real do topo',
 [C.NAME,C.S,C.THUNDER,C.GREED,C.MARCH],[],{
 check:(b,t)=>{assert.ok(!activated(t,C.NAME));assert.ok(b.players[0].hand.some(c=>c.code===C.NAME));}
});
await play('Ahrima não oferece a si mesmo só para comprar sem ganho',
 [C.S,C.THUNDER,C.GREED,C.MARCH,C.NAME],[field(C.AH)],{
 check:(b,t)=>{assert.ok(inField(b,C.AH));assert.ok(!activated(t,C.AH));}
});
await play('Covil e Controlador removem um inimigo e tomam outro',
 [C.CONTROL,C.S,C.THUNDER,C.GREED,C.MARCH],[lair,field(BLUE,1),field(OX,1,1)],{
 until:(ctx)=>ctx.prompt.type===M.SELECT_IDLECMD&&ctx.readBoard(true).players[0].monsters.some(c=>c?.code===OX),
 check:b=>{assert.ok(inField(b,OX));assert.ok(b.players[1].grave.some(c=>c.code===BLUE));}
});
await play('Duke usa o adversário e recupera Vishuda',
 [C.DUKE,C.S,C.THUNDER,C.GREED,C.MARCH],[lair,{player:0,zone:L.GRAVE,code:C.VISHUDA},field(BLUE,1)],{
 until:ctx=>ctx.prompt.type===M.SELECT_IDLECMD&&ctx.readBoard(true).players[0].hand.some(c=>c.code===C.VISHUDA),
 check:b=>{assert.ok(inField(b,C.DUKE));assert.ok(b.players[0].hand.some(c=>c.code===C.VISHUDA));}
});
await play('Covil só paga um custo: não entrega Ahrima para um segundo Controlador',
 [C.CONTROL,C.S,C.THUNDER,C.GREED,C.MARCH],[lair,field(C.AH),field(BLUE,1),field(OX,1,1)],{
 check:(b,t)=>{assert.ok(inField(b,C.AH));assert.ok(b.players[1].grave.some(c=>c.code===BLUE));assert.ok(!activated(t,C.CONTROL));}
});
await play('Tellus LUZ sem Covil não é um custo TREVAS substituível',
 [C.S,C.THUNDER,C.GREED,C.MARCH,C.NAME],[field(C.AH),field(19280589,0,1)],{
 check:(b,t)=>{assert.ok(inField(b,C.AH));assert.ok(inField(b,19280589));assert.ok(!activated(t,C.AH));}
});
await play('Breaker não destrói o próprio Campo',
 [71413901,C.S,C.THUNDER,C.GREED,C.MARCH],[lair],{
 check:(b,t)=>{assert.equal(b.players[0].field?.code,C.LAIR);assert.ok(!activated(t,71413901));}
});
await play('Guarda transfere o Marcador para proteger o Covil',
 [C.GUARD,C.S,C.THUNDER,C.GREED,C.MARCH],[lair],{
 check:b=>{assert.equal(b.players[0].field?.code,C.LAIR);assert.ok(b.players[0].field.counters.some(c=>c.count>0));}
});
await play('a mesma linha de Reator funciona no assento 1',
 [C.REACTOR,C.ADVANCE,C.S,C.THUNDER,C.MARCH],[],{seat:1,
 check:b=>assert.ok(inField(b,C.S))
});
await play('Ataque Força Trovão limpa o campo e aplica a compra na Main Phase',
 [C.THUNDER,C.GUARD,C.MARCH,C.REBORN,C.GREED],[field(C.S),field(BLUE,1),field(OX,1,1)],{
 check:(b,t)=>{assert.ok(inField(b,C.S));assert.equal(b.players[1].monsters.filter(Boolean).length,0);
  assert.ok(activated(t,C.THUNDER));assert.ok(t.some(t=>t.prompt===M.SELECT_YESNO&&t.response.yes&&t.guideLesson==='thunderforce-protege-e-recompoe-a-mao'));}
});
await play('preserva Cruzar Almas quando a Normal de Slifer já está disponível',
 [C.CROSS,C.S,C.THUNDER,C.MARCH,C.GREED],[field(C.REACTOR),field(C.AH,0,1),field(C.SKY,0,2)],{
 check:(b,t)=>{assert.ok(inField(b,C.S));assert.ok(!activated(t,C.CROSS));}
});
await play('Livro da Lua não vira o próprio Slifer só porque o efeito é legal',
 [14087893,C.GREED,C.MARCH,C.NAME,C.THUNDER],[field(C.S)],{
 check:(b,t)=>{assert.ok(inField(b,C.S));assert.ok(!b.players[0].monsters.find(c=>c?.code===C.S).faceDown);assert.ok(!activated(t,14087893));}
});

// O conhecimento do topo vem do prompt de ordenação e expira em alterações reais.
const empty=()=>({monsters:Array(7).fill(null),spells:Array(5).fill(null),field:null,hand:[],grave:[],banished:[],extra:[],deckSize:35,graveSize:0,banishedSize:0,extraSize:0,extraFaceUp:0,graveTop:null});
const card=(code,location=L.HAND,controller=0,sequence=0)=>({code,location,controller,sequence,position:P.FACEUP_ATTACK,faceDown:false,defense:false,attack:db.get(code)?.atk??0,defenseValue:db.get(code)?.def??0,counters:[],overlays:[]});
const idle=cards=>({type:M.SELECT_IDLECMD,player:0,summons:[],special_summons:[],monster_sets:[],spell_sets:[],pos_changes:[],activates:cards,to_ep:true,to_bp:false,shuffle:false});
const context=(prompt,board,revision=0)=>({prompt,me:0,readBoard:()=>board,cardDb:db,lifePoints:[8000,8000],phase:4,turnPlayer:0,turnCount:1,deckRevision:revision,format:'tcg',chainOpen:false});
for(const changed of [false,true]) {
 const b={players:[empty(),empty()]};b.players[0].hand=[card(C.NAME),card(C.REACTOR),card(C.THUNDER)];
 const brain=new BotBrain({deck,format:'tcg'}),sort={type:M.SORT_CARD,player:0,cards:[card(C.GREED,L.DECK),card(C.S,L.DECK,0,1)]};
 brain.decide({...context(sort,b),resolvingEffect:{code:C.ADVANCE,player:0,description:BigInt(C.ADVANCE)<<20n,link:1,negated:false}});
 const response=brain.decide(context(idle([{...card(C.NAME),description:BigInt(C.NAME)<<20n}]),b,Number(changed)));
 assert.equal(response.action,changed?A.TO_EP:A.SELECT_ACTIVATE,'embaralhamento invalida a declaração, mesmo com Deck do mesmo tamanho');
}
{
 const k=new BotKnowledge(0),sort={type:M.SORT_CARD,player:0,cards:[card(C.GREED,L.DECK),card(C.S,L.DECK,0,1)]};
 k.observe(sort);const move={type:M.MOVE,card:0,from:{controller:0,location:L.DECK,sequence:0,position:10},to:{controller:0,location:L.DECK,sequence:1,position:10}};
 k.observe(move);k.observe(move);assert.equal(k.context().deckRevision,0,'movimentos da ordenação conhecida não são um embaralhamento');
 k.observe({...move});assert.equal(k.context().deckRevision,1,'reordenação posterior desconhecida invalida o topo');
 k.observe({type:M.SHUFFLE_DECK,player:0});assert.equal(k.context().deckRevision,2);
 k.observe({type:M.DRAW,player:0,cards:[{code:C.S,position:10}]});assert.ok(k.context().deckRevision>2);
}
{
 const b={players:[empty(),empty()]};b.players[0].grave=[card(C.S,L.GRAVE)];b.players[0].hand=[card(C.REBORN),card(C.MARCH),card(C.NAME)];
 const brain=new BotBrain({deck,format:'tcg'}),prompt=idle([{...card(C.REBORN),description:0n}]);
 assert.equal(brain.decide({...context(prompt,b),phase:0x100}).action,A.TO_EP,'não reanima Slifer na Main 2 sem retorno');
 const other=new BotBrain({deck:{...deck,main:deck.main.slice(1)},format:'tcg'});
 other.decide(context(prompt,b));assert.equal(other.lastTrace.guideLesson,null,'política só se aplica à lista revisada');
}
console.log('✓ custo, memória do topo, alteração de ordem, Main 2 e isolamento de outras listas');

// Caminho usado pelo navegador: a sessão delega a política ao worker real.
{
 const registry=CardRegistry.fromCatalog(JSON.parse(readFileSync('.cache/catalog/catalog.json','utf8'))),session=createDuelSession(),traces=[];
 try {
  await session.start({playerName:'Slifer',playerDeck:deck,opponentName:'Parceiro',opponentDeck:foe,registry,assets:nodeAssets,format:'tcg',pace:0,cutIns:false,watchSeat:0,testSeed:73,
   openingHands:[[C.ADVANCE,C.NAME,C.REACTOR,C.THUNDER,C.GREED],foe.main.slice(0,5)],
   seats:[{kind:'bot',name:'Slifer',bot:{execution:'worker',onDecision:t=>traces.push(t)}},{kind:'local',name:'Parceiro'}]});
  assert.equal(session.getSnapshot().error,null);assert.ok(inField(readBoardState(session.core,session.handle,0),C.S));
  assert.ok(traces.some(t=>t.execution?.mode==='worker'&&t.guideLesson==='avanco-e-o-nome-verdadeiro'));
  assert.ok(traces.every(t=>t.source!=='rejected-recovery'&&t.source!=='fallback-error'));
  console.log('✓ DuelSession + worker: Avanço, Nome Verdadeiro e Reator chegam a Slifer por Tributo');
 }finally{session.dispose();}
}
