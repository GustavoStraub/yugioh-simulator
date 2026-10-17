/** Regressões estratégicas: informação, custos alternativos, negação e recursos. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OcgMessageType as M,OcgResponseType as R,OcgLocation as L,OcgPosition as P,SelectIdleCMDAction as A } from '@n1xx1/ocgcore-wasm';
import { BotBrain } from '@/lib/duel/bot/bot-brain';
import { BotKnowledge } from '@/lib/duel/bot/knowledge';
import { BotIntentStack } from '@/lib/duel/bot/intent';
import { loadBotProfile,validateBotProfile } from '@/lib/duel/bot/deck-profile';
import { validBotResponse } from '@/lib/duel/bot/response-validator';
import { OfficialCardDb } from '@/lib/duel/official-card-data';
import { CardRegistry } from '@/lib/domain/card-registry';
import { getPresetDeck } from '@/lib/data/preset-decks-catalog';
import { createDuelSession } from '@/lib/duel/duel-session';
import { readBoardState } from '@/lib/duel/board-state';
import { botAutoResponse } from '@/lib/duel/bot-responder';
const db = new OfficialCardDb(JSON.parse(readFileSync('src/data/card-db.json','utf8')));
const registry=CardRegistry.fromCatalog(JSON.parse(readFileSync('.cache/catalog/catalog.json','utf8')));
import { nodeAssets } from '@/server/duel/node-assets';
const deck=getPresetDeck('tcg-sdaz'), profile=await loadBotProfile(deck,'tcg');
const empty=()=>({monsters:Array(7).fill(null),spells:Array(6).fill(null),field:null,hand:[],grave:[],banished:[],extra:[],deckSize:40,graveSize:0,banishedSize:0,extraSize:0,extraFaceUp:0,graveTop:null});
const card=(code,location=L.HAND,sequence=0,controller=0)=>({code,location,sequence,controller,position:P.FACEUP_ATTACK,faceDown:false,defense:false,attack:db.get(code)?.atk??0,defenseValue:db.get(code)?.def??0,counters:[],negated:false});
const ctx=(prompt,board={players:[empty(),empty()]})=>({prompt,me:0,readBoard:()=>board,cardDb:db,lifePoints:[8000,8000],phase:4,turnPlayer:0,turnCount:1,format:'tcg',chainOpen:false});
const idle=(cards=[])=>({type:M.SELECT_IDLECMD,player:0,summons:[],special_summons:[],monster_sets:[],spell_sets:[],pos_changes:[],activates:cards,to_ep:true,to_bp:false,shuffle:false});
const select=(cards,min=1,max=1)=>({type:M.SELECT_CARD,player:0,min,max,can_cancel:false,selects:cards});
{
  const observations=[];
  for(const secret of [89631139,91152256]){
    const k=new BotKnowledge(0);
    const raw=select([card(secret,L.HAND,0,1),card(5053103,L.HAND,1,1)]);
    const masked=k.mask(raw);
    assert.ok(masked.selects.every(c=>c.code===0));
    observations.push(new BotBrain({difficulty:'hard',seed:29}).decide(ctx(masked)));
  }
  assert.deepEqual(observations[0],observations[1],'mesma observação e semente: mesma decisão');
  const k=new BotKnowledge(0), other=new BotKnowledge(1);
  const reveal={type:M.CONFIRM_CARDS,player:0,cards:[card(89631139,L.HAND,0,1)]};
  k.observe(reveal);other.observe(reveal);
  assert.equal(k.mask(select(reveal.cards)).selects[0].code,89631139);
  assert.equal(other.context().observedFacts.length,0,'memória independente por assento');
  k.observe({type:M.SHUFFLE_HAND,player:1,cards:[89631139]});
  assert.equal(k.mask(select(reveal.cards)).selects[0].code,0);
  assert.equal(k.context().observedFacts[0].place,null,'embaralhamento invalida localização');
  const board={players:[empty(),empty()]};
  board.players[1].monsters[0]={...card(null,L.MZONE,0,1),faceDown:true};
  const tribute={type:M.SELECT_TRIBUTE,player:0,min:1,max:1,can_cancel:false,selects:[{...card(89631139,L.MZONE,0,1),release_param:1}]};
  assert.equal(k.mask(tribute,()=>board).selects[0].code,0,'tributo sem posição não revela monstro oculto');
  const targeted=new BotKnowledge(0);
  targeted.observe({type:M.CHAINING,code:5318639,controller:1,chain_size:1,description:0n});
  targeted.observe({type:M.BECOME_TARGET,cards:[{controller:0,location:L.SZONE,sequence:2,position:P.FACEUP_ATTACK}]});
  targeted.observe({type:M.MOVE,from:{controller:0,location:L.SZONE,sequence:2},to:{controller:0,location:L.GRAVE,sequence:0}});
  assert.equal(targeted.context().chainTargets[0].present,false,'nova ocupante da zona não herda o alvo');
  console.log('✓ observações ocultas equivalentes, revelação por assento e esquecimento após embaralhar');
}
{
  const intents=new BotIntentStack();intents.begin(44362883,null,null,1n);intents.begin(14558127,null,null,2n);
  assert.equal(intents.current({code:44362883,description:1n,negated:false})?.code,44362883,'resposta não sobrescreve intenção anterior');
  assert.equal(intents.current({code:44362883,description:1n,negated:true}),null);
  assert.equal(validateBotProfile({...profile,schemaVersion:2}),false);
  const invalid=structuredClone(profile);invalid.routes[0].steps[0].targets[0].code=99999999;
  assert.equal(validateBotProfile(invalid),false);
  assert.equal(new BotBrain({deck:{...deck,main:deck.main.slice(1)},profile,format:'tcg'}).planner.profile,null);
  console.log('✓ intenções empilhadas e rejeição de perfil inválido ou lista incompatível');
}
{
  const p=select([card(44362883),card(10813327)],0,1);
  assert.equal(validBotResponse(p,{type:R.SELECT_CARD,indicies:[0,0]},db),false);
  assert.equal(validBotResponse(p,{type:R.SELECT_CARD,indicies:[2]},db),false);
  assert.equal(validBotResponse(p,{type:R.SELECT_CARD,indicies:null},db),false);
  assert.equal(validBotResponse(p,{type:R.SELECT_CARD,indicies:[]},db),true);
  const b=new BotBrain();const first=b.decide(ctx(p));const second=b.decide({...ctx(p),retryCount:1});
  assert.notDeepEqual(first,second,'não repete resposta rejeitada havendo alternativa');
  console.log('✓ contrato de índices, quantidade, cancelamento e recuperação após RETRY');
}
{
  const b=new BotBrain({difficulty:'hard'}), board={players:[empty(),empty()]};
  const p=idle([card(44362883)]);
  for(let i=0;i<35;i++){board.players[0].graveSize=i;assert.equal(b.decide(ctx(p,board)).action,A.SELECT_ACTIVATE,'progresso permite sequência longa');}
  const responses=Array.from({length:30},()=>b.decide(ctx(p,board)));
  assert.ok(responses.some(r=>r.action===A.TO_EP),'repetição sem progresso termina');
  console.log('✓ sequência longa com progresso e interrupção de repetição sem progresso');
}
async function play(hand,{negate=false,opponentSecret=5053103,difficulty='hard'}={}){
  const session=createDuelSession(),trace=[];
  const foe={main:[14558127,...Array(39).fill(opponentSecret)],extra:[],side:[],format:'tcg'};
  let board,stopped=false;
  try{
    await session.start({playerName:'Bot',playerDeck:deck,opponentName:'Parceiro',opponentDeck:foe,registry,assets:nodeAssets,format:'tcg',pace:0,cutIns:false,testSeed:73,
      openingHands:[hand,[14558127,...Array(4).fill(opponentSecret)]],watchSeat:0,
      seats:[{kind:'bot',name:'Bot',bot:{difficulty,onDecision(t){trace.push(t);if(t.prompt===M.SELECT_IDLECMD&&trace.length>1&&t.route===null){board=readBoardState(session.core,session.handle,0);stopped=true;session.dispose();}}}},{kind:'local',name:'Parceiro',chainMode:'always'}]});
    let answered=0,ash=false;
    while(!stopped&&session.getSnapshot().pendingPrompt&&answered++<60){
      const snap=session.getSnapshot(),p=snap.pendingPrompt;
      let response=botAutoResponse(p);
      if(p.type===M.SELECT_CHAIN){const i=p.selects.findIndex(c=>c.code===14558127);if(negate&&!ash&&i>=0){response={type:R.SELECT_CHAIN,index:i};ash=true;}else response={type:R.SELECT_CHAIN,index:null};}
      await session.respond(response,snap.promptId);
    }
    assert.equal(session.getSnapshot().error,null);assert.ok(stopped,'bot retoma a Main Phase');
    return {board,trace,ash};
  }finally{session.dispose();}
}
for(const hand of [
 [44362883,10813327,97268402,24224830,59919307],
 [44362883,10813327,19096726,24224830,59919307],
 [45484331,10813327,97268402,24224830,59919307],
 [45484331,10813327,97268402,24224830,81223446],
 [44362883,59919307,97268402,24224830,81223446],
]){
 const {board,trace}=await play(hand);
 assert.ok(board.players[0].monsters.some(c=>c?.code===44146295),'perfil integral completa a Fusão');
 const reserve=hand.includes(19096726)?19096726:97268402;
 assert.ok(board.players[0].hand.some(c=>c.code===reserve),'preserva interação na mão');
 console.log(`✓ sessão e perfil integral: mão ${hand.join(',')} · ${trace[0].route}`);
}
{
 const hand=[44362883,10813327,97268402,24224830,59919307];
 const a=await play(hand,{opponentSecret:5053103}),b=await play(hand,{opponentSecret:89631139});
 assert.deepEqual(a.trace.map(t=>t.response),b.trace.map(t=>t.response),'listas privadas diferentes não alteram decisões do bot');
 const interrupted=await play(hand,{negate:true});
 assert.ok(interrupted.ash,'a interrupção aconteceu no motor');
 assert.ok(interrupted.trace.some(t=>t.reason.includes('negado')||t.reason.includes('reavaliad')),'negação invalida intenção');
 assert.ok(!interrupted.board.players[0].monsters.some(c=>c?.code===44146295),'não inventa resolução da Fusão negada');
 assert.ok(interrupted.board.players[0].hand.some(c=>c.code===97268402),'preserva defesa após negação');
 console.log('✓ sessão real: estado oculto substituído e replanejamento após Ash Blossom');
}
