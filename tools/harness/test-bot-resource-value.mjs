/** Gasto sem retorno: decisões e consequências no mesmo core usado pelo app. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OcgMessageType as M, OcgLocation as L, OcgPosition as P, SelectIdleCMDAction as A } from '@n1xx1/ocgcore-wasm';
import { BotBrain } from '@/lib/duel/bot/bot-brain';
import { OfficialCardDb } from '@/lib/duel/official-card-data';
import { CardRegistry } from '@/lib/domain/card-registry';
import { createDuelSession } from '@/lib/duel/duel-session';
import { readBoardState } from '@/lib/duel/board-state';
import { nodeAssets } from '@/server/duel/node-assets';
import { validBotResponse } from '@/lib/duel/bot/response-validator';
import { BOT_DIFFICULTIES } from '@/lib/duel/bot/difficulty';
import { saveDuelSetup, loadDuelSetup } from '@/lib/duel/duel-storage';

const db = new OfficialCardDb(JSON.parse(readFileSync('src/data/card-db.json','utf8')));
const empty = () => ({monsters:Array(7).fill(null),spells:Array(6).fill(null),field:null,hand:[],grave:[],banished:[],extra:[],deckSize:40,graveSize:0,banishedSize:0,extraSize:0,extraFaceUp:0,graveTop:null});
const card = (code,location=L.MZONE,controller=0,sequence=0,faceDown=false) => ({code,location,controller,sequence,faceDown,defense:faceDown,position:faceDown?P.FACEDOWN_DEFENSE:P.FACEUP_ATTACK,attack:db.get(code)?.atk??0,defenseValue:db.get(code)?.def??0,overlays:[],counters:[],negated:false});
const active = (code,location=L.MZONE,index=0) => ({...card(code,location),description:(BigInt(code)<<20n)+BigInt(index)});
const idle = (effect) => ({type:M.SELECT_IDLECMD,player:0,summons:[],special_summons:[],monster_sets:[],spell_sets:[],pos_changes:[],activates:[effect],to_ep:true,to_bp:false,shuffle:false});
const chain = (effect) => ({type:M.SELECT_CHAIN,player:0,selects:[effect],forced:false,special_count:0,hint_timing:0,other_timing:0});
const ctx = (prompt,board,extra={}) => ({prompt,me:0,cardDb:db,readBoard:()=>board,lifePoints:[8000,8000],phase:4,turnPlayer:0,turnCount:1,format:'tcg',chainOpen:false,...extra});
const board = () => ({players:[empty(),empty()]});
function refuses(effect,b,extra={}) {
  for (const prompt of [idle(effect),chain(effect),{type:M.SELECT_EFFECTYN,...effect,player:0}]) {
    const brain=new BotBrain(), c=ctx(prompt,b,extra), r=brain.decide(c);
    assert.ok(validBotResponse(prompt,r,db));
    assert.ok(prompt.type===M.SELECT_IDLECMD?r.action===A.TO_EP:prompt.type===M.SELECT_CHAIN?r.index===null:!r.yes,
      `${effect.code} deve guardar recursos em ${prompt.type}: ${JSON.stringify(r)}`);
  }
}
{
  for(const [code,location] of [[5318639,L.HAND],[17449108,L.HAND],[45939841,L.HAND],[43898403,L.HAND],[6983839,L.MZONE],[84290642,L.MZONE],[4178474,L.SZONE],[95169481,L.MZONE],[82633039,L.MZONE]]) {
    const b=board(); b.players[0].spells[0]=card(44095762,L.SZONE,0,0,true);
    b.players[0].monsters[0]=card(code);
    refuses(active(code,location),b);
  }
  const b=board();b.players[0].monsters[0]=card(68464358);
  refuses(active(68464358),b);
  // Um monstro adversário face-up não é alvo de Nobleman. Sem este filtro
  // bastava o adversário ter QUALQUER monstro para banir nosso próprio set.
  b.players[0].monsters[1]=card(31560081,L.MZONE,0,1,true);
  b.players[1].monsters[0]=card(89631139,L.MZONE,1);
  refuses(active(71044499,L.HAND),b);
  console.log('✓ magias, armadilhas e monstros recusam destruição própria sem ganho');
}
{
  const b=board(); b.players[1].field=card(59160188,L.FZONE,1);
  const brain=new BotBrain();
  assert.equal(brain.decide(ctx(idle(active(5318639,L.HAND)),b)).action,A.SELECT_ACTIVATE);
  b.players[1].field=null;
  b.players[1].spells[0]=card(32807846,L.SZONE,1);
  const effect={code:32807846,player:1,location:L.SZONE,sequence:0,description:0n,link:1,negated:false};
  refuses(active(5318639,L.SZONE),b,{chainPlayer:1,chainCode:32807846,chainEffect:effect,chainOpen:true});
  console.log('✓ reconhece Magia de Campo; Tufão não é gasto para tentar negar Magia Normal');
}
{
  for(const code of [76774528,62709239,95169481]) {
    const b=board();b.players[0].monsters[0]=card(code);
    b.players[1].monsters[0]=card(46986414,L.MZONE,1); // Dark Magician, 2500
    b.players[1].monsters[0]=card(46986414,L.MZONE,1,0,true);
    refuses(active(code),b);
    b.players[0].spells[0]=card(44095762,L.SZONE,0,0,true);
    b.players[1].monsters[0]=card(89631139,L.MZONE,1);
    if(code===95169481)b.players[0].monsters[1]=card(46986414,L.MZONE,0,1); // not a Beast
    const r=new BotBrain().decide(ctx(idle(active(code)),b));
    assert.equal(r.action,A.SELECT_ACTIVATE,`${code}: troca favorável deve continuar disponível`);
  }
  const b=board();b.players[0].monsters[0]={...card(62709239),overlays:[90432163,36426778]};
  b.players[1].monsters[0]=card(46986414,L.MZONE,1,0,true);
  const brain=new BotBrain();assert.equal(brain.decide(ctx(idle(active(62709239)),b)).action,A.SELECT_ACTIVATE);
  b.players[0].spells[0]=card(44095762,L.SZONE);
  const targets=[card(62709239),card(44095762,L.SZONE)];
  const picked=brain.decide(ctx({type:M.SELECT_CARD,player:0,selects:targets,min:1,max:1,can_cancel:false},b));
  assert.deepEqual(picked.indicies,[0],'Break Sword escolhe a própria destruição quando ela abre duas reanimações');
  console.log('✓ compara o custo da troca; preserva Break Sword e sua continuação útil');
}
{
  const b=board();b.players[0].monsters[0]=card(68464358);
  b.players[0].spells[0]=card(31443476,L.SZONE);
  const extra={chainPlayer:0,chainCode:31443476,chainOpen:true,chainEffect:{code:31443476,description:0n,player:0,location:L.SZONE,sequence:0,link:1,negated:false}};
  const brain=new BotBrain();assert.equal(brain.decide(ctx(chain(active(68464358)),b,extra)).index,0);
  const r=brain.decide(ctx({type:M.SELECT_CARD,player:0,min:1,max:1,can_cancel:false,selects:[card(68464358),card(31443476,L.SZONE)]},b,extra));
  assert.deepEqual(r.indicies,[1],'Tracer destrói Quick Launch que já resolverá, preservando o Tuner');
  console.log('✓ Tracer usa a Magia em resolução como recurso e mantém o próprio monstro');
}
{
  const b=board(); b.players[0].monsters[0]=card(44508094);
  refuses(active(44508094),b,{chainPlayer:0,chainCode:53129443,chainOpen:true});
  const revived=new BotBrain().decide(ctx(chain(active(44508094,L.GRAVE,1)),b));
  assert.equal(revived.index,0,'recuperação de Stardust não é confundida com a negação');
  const heavy=board();heavy.players[0].field=card(59160188,L.FZONE);
  heavy.players[1].spells[0]=card(44095762,L.SZONE,1,0,true);
  refuses(active(19613556,L.HAND),heavy);
  console.log('✓ Stardust não nega a própria jogada; limpeza considera a própria Magia de Campo');
}

const registry=CardRegistry.fromCatalog(JSON.parse(readFileSync('.cache/catalog/catalog.json','utf8')));
const filler=24094653; // Polymerization sem Extra Deck: nenhuma ação disponível.
async function realCase(code,own,foe,{activate=false,extra=[],survivor=own[0]?.code}={}) {
  const session=createDuelSession(),traces=[];
  const deck={main:[code,...extra,...Array(39-extra.length).fill(filler)],extra:[],side:[],format:'tcg'};
  try {
    await session.start({playerName:'Bot',opponentName:'Parceiro',playerDeck:deck,opponentDeck:deck,
      registry,assets:nodeAssets,format:'tcg',pace:0,cutIns:false,watchSeat:0,testSeed:73,
      openingHands:[Array(5).fill(filler),Array(5).fill(filler)],
      scenario:[...own.map(c=>({player:0,...c})),...foe.map(c=>({player:1,...c}))],
      seats:[{kind:'bot',name:'Bot',bot:{onDecision(t){traces.push(t);}}},{kind:'local',name:'Parceiro'}]});
    assert.equal(session.getSnapshot().error,null);
    const activated=traces.some(t=>t.prompt===M.SELECT_IDLECMD&&t.response.action===A.SELECT_ACTIVATE&&t.observation.prompt.activates[t.response.index]?.code===code
      ||t.prompt===M.SELECT_CHAIN&&t.response.index!==null&&t.observation.prompt.selects[t.response.index]?.code===code);
    assert.equal(activated,activate,`${code}: decisão comprovada no motor real`);
    const mine=readBoardState(session.core,session.handle,0).players[0];
    if(!activate&&survivor)assert.ok([...mine.monsters,...mine.spells].some(c=>c?.code===survivor),`${code}: carta própria preservada`);
    if(activate)assert.ok(readBoardState(session.core,session.handle,0).players[1].grave.some(c=>c.code===foe[0].code),'remoção resolveu e enviou o alvo ao cemitério');
    assert.ok(traces.every(t=>!t.fallback?.includes('rejeitada')));
  } finally {session.dispose();}
}
const setMirror={code:44095762,location:L.SZONE,sequence:0,position:P.FACEDOWN_DEFENSE};
await realCase(5318639,[setMirror,{code:5318639,location:L.SZONE,sequence:1,position:P.FACEDOWN_DEFENSE}],[]);
await realCase(6983839,[{code:6983839,location:L.MZONE},setMirror],[]);
await realCase(84290642,[{code:84290642,location:L.MZONE},setMirror],[]);
await realCase(68464358,[{code:68464358,location:L.MZONE},setMirror],[],{extra:[5969957]});
await realCase(71044499,[{code:31560081,location:L.MZONE,position:P.FACEDOWN_DEFENSE},{code:71044499,location:L.HAND}], [{code:89631139,location:L.MZONE}]);
await realCase(76774528,[{code:76774528,location:L.MZONE}],[{code:46986414,location:L.MZONE,position:P.FACEDOWN_DEFENSE}]);
await realCase(76774528,[{code:76774528,location:L.MZONE},setMirror],[{code:89631139,location:L.MZONE}],{activate:true});
await realCase(5318639,[{code:5318639,location:L.HAND}],[{code:59160188,location:L.SZONE,sequence:5}],{activate:true});
console.log('✓ 8 cenários no motor real: preservação das próprias cartas e remoções favoráveis resolvidas');

// Configurações antigas e revanche também chegam ao mesmo nível forte.
assert.deepEqual(BOT_DIFFICULTIES.map(d=>d.id),['hard']);
const stored=new Map();globalThis.window={};globalThis.sessionStorage={getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)};
try {
  for(const legacy of [undefined,'easy','medium','hard']) {
    stored.set('yugioh-goat-duel-setup-v1',JSON.stringify({botDifficulty:legacy,playerBotDifficulty:legacy}));
    assert.equal(loadDuelSetup().botDifficulty,'hard');assert.equal(loadDuelSetup().playerBotDifficulty,'hard');
  }
  saveDuelSetup({botDifficulty:'easy',playerBotDifficulty:'medium'});
  assert.equal(JSON.parse(stored.get('yugioh-goat-duel-setup-v1')).botDifficulty,'hard');
} finally {delete globalThis.window;delete globalThis.sessionStorage;}
console.log('✓ nível único Difícil para novos duelos, configurações antigas e espectador');
