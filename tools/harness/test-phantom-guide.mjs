import assert from 'node:assert/strict';
import {OcgDuelMode,OcgMessageType as M,OcgResponseType as R,SelectIdleCMDAction as A} from '@n1xx1/ocgcore-wasm';
import {getDeckGuide} from '@/lib/data/deck-guides';
import {getPresetDeck} from '@/lib/data/preset-decks-catalog';
import {readBoardState} from '@/lib/duel/board-state';
import {createDuelSession} from '@/lib/duel/duel-session';
import {advancePractice,EMPTY_PRACTICE,practiceCardTargets,practiceConditionMet} from '@/lib/duel/lesson-practice';
import {practiceSetup} from '@/lib/duel/practice-setup';
import {deckAfterOpeningHand} from '@/lib/duel/opening-hand';
import {createDuel,STOP,Zone as L} from './duel.mjs';
const guide=getDeckGuide('herois-lendarios-cavaleiros-fantasmas'),deck=getPresetDeck(guide.presetId);
const C={cloak:90432163,boots:36426778,gloves:63821877,helm:99315585,armor:36704180,sword:62709239,rusty:26692769,fog:25542642,wing:98431356,blade:61936647,rebellion:16195942,requiem:1621413,launch:3298689,leviair:95992081,shade:98827725,arma:28985331,nightmare:359563,ferret:56343672,foolish:81439173,reborn:83764718,hole:53129443,twin:43898403,spear:98153934,vambrace:36247316,javelin:12219047};
const n=c=>[C[c],'summons'],ss=c=>[C[c],'special_summons'],a=c=>[C[c]],set=c=>[C[c],'spell_sets'];
const base=[n('cloak'),ss('boots'),ss('sword'),a('sword'),ss('rebellion')];
const moves={
'espada-quebrada-abre-o-classe-4':base,
'rebeliao-sem-materiais-vira-requiem':[...base,a('rebellion'),a('launch'),a('requiem')],
'a-seta-de-bardiche-transforma-xyz-em-remocao':[n('cloak'),ss('boots'),ss('sword'),ss('nightmare')],
'ragged-gloves-prepara-a-armadilha-certa':[a('foolish'),a('gloves'),n('cloak'),a('hole'),a('fog'),ss('boots'),ss('sword')],
'brigandina-antes-das-armadilhas-no-cemiterio':[n('arma'),set('shade'),a('shade'),ss('nightmare')],
'luvas-concede-mil-ao-xyz-de-trevas':[n('gloves'),ss('boots'),ss('sword')],
'furao-usa-as-duas-setas':[n('ferret'),a('ferret'),ss('sword')],
'launch-no-cemiterio-recarrega-o-xyz':[n('arma'),set('shade'),a('shade'),ss('nightmare'),a('twin'),a('launch')],
'fog-blade-tem-duas-funcoes-em-turnos-diferentes':[a('fog'),n('cloak'),a('hole'),a('fog'),ss('boots'),ss('sword')],
'bracadeira-abre-dardo-amaldicoado':[n('cloak'),a('vambrace'),ss('javelin'),a('javelin')],
};
for(const lesson of guide.lessons.filter(l=>moves[l.id])){
 const setup=practiceSetup(deck,lesson);
 const duel=await createDuel({mode:OcgDuelMode.MODE_MR5,decks:[deckAfterOpeningHand(setup.playerDeck,lesson.startingHand,5).main,setup.opponentDeck.main],place:[...lesson.startingHand.map(code=>({player:0,zone:L.HAND,code})),...setup.playerDeck.extra.map(code=>({player:0,zone:L.EXTRA,code})),...setup.scenario.map(c=>({...c,zone:c.location}))]});
 let move=0,active=0,practice=EMPTY_PRACTICE;const trace=[],initial=createDuelSession().getSnapshot();
 try{
 const result=duel.run(p=>{
 if(p.player!==0)return null;
 const snapshot={...initial,boards:[readBoardState(duel.core,duel.handle,0),null],lifePoints:[...duel.lifePoints],turnCount:1,turnPlayer:0,promptPlayer:0,pendingPrompt:p};practice=advancePractice(lesson,snapshot,practice);trace.push(p);
 if(p.type===M.SELECT_IDLECMD){const next=moves[lesson.id][move++];if(!next)return STOP;const [code,list='activates']=next;active=code;const index=p[list].findIndex(c=>c.code===code);assert.ok(index>=0,`${lesson.id}: ${list} ${code} disponível`);assert.ok(practiceCardTargets(lesson,snapshot,{...practice,completed:false}).some(t=>t.code===code),`GUIA indica ${code}, etapa ${practice.reached}`);return {type:R.SELECT_IDLECMD,index,action:({activates:A.SELECT_ACTIVATE,summons:A.SELECT_SUMMON,special_summons:A.SELECT_SPECIAL_SUMMON,spell_sets:A.SELECT_SPELL_SET})[list]};}
 if(p.type===M.SELECT_EFFECTYN){active=p.code;return {type:R.SELECT_EFFECTYN,yes:true};}
 if(p.type===M.SELECT_CHAIN){const index=p.selects.findIndex(c=>c.code===C.rusty||c.code===C.sword);if(index>=0){active=p.selects[index].code;}return {type:R.SELECT_CHAIN,index:index>=0?index:null};}
 if(p.type===M.SELECT_PLACE){
  const preferred=active===C.ferret?[1,0,2]:active===C.rusty?[0,2]:[0,2,1,3,4];
  const zone=preferred.find(z=>(p.field_mask&(1<<z))===0);
  if(zone!==undefined)return {type:R.SELECT_PLACE,places:[{player:0,location:L.MZONE,sequence:zone}]};
 }
 if(p.type===M.SELECT_SUM)return {type:R.SELECT_SUM,indicies:[p.selects.findIndex(c=>c.code===C.cloak),p.selects.findIndex(c=>c.code===C.boots)]};
 if(p.type===M.SELECT_CARD||p.type===M.SELECT_UNSELECT_CARD){
  const cards=p.type===M.SELECT_CARD?p.selects:p.select_cards;
  if(p.type===M.SELECT_UNSELECT_CARD&&p.can_finish)return {type:R.SELECT_UNSELECT_CARD,index:null};
  let wanted=[];
  if(cards.every(c=>c.overlay_sequence!==undefined))wanted=active===C.requiem?[C.launch]:active===C.javelin?[C.vambrace]:[C.boots,C.cloak,C.gloves];
  else if(active===C.foolish)wanted=[C.gloves];
  else if(active===C.gloves)wanted=[C.fog];
  else if(active===C.arma)wanted=[C.cloak];
  else if(active===C.ferret)wanted=[C.cloak,C.boots];
  else if(active===C.twin)wanted=cards.every(c=>c.controller===1)?[C.spear,C.blade]:[C.launch];
  else if(active===C.launch)wanted=[C.requiem,C.rebellion,C.nightmare,C.boots];
  else if(active===C.rusty)wanted=lesson.id==='furao-usa-as-duas-setas'?[C.helm]:[C.sword];
  else if(active===C.rebellion||active===C.requiem)wanted=[C.armor];
  else if(active===C.javelin)wanted=[C.helm];
  else if(active===C.vambrace)wanted=[C.cloak];
  else if(active===C.fog)wanted=cards.some(c=>c.controller===1)?[C.helm]:[C.cloak];
  else if(active===C.sword&&cards.some(c=>c.controller===1))wanted=[C.helm];
  else if(active===C.sword&&cards.some(c=>c.location===L.MZONE)&&!p.select_cards)wanted=[C.sword];
  else wanted=[C.cloak,C.boots,C.gloves,C.arma,C.shade,C.vambrace];
  const indices=cards.map((c,i)=>({i,n:wanted.indexOf(c.code)})).filter(x=>x.n>=0).sort((a,b)=>a.n-b.n).map(x=>x.i);
  if(p.type===M.SELECT_UNSELECT_CARD)return {type:R.SELECT_UNSELECT_CARD,index:indices[0]??0};
  const count=active===C.ferret||active===C.twin&&cards.every(c=>c.controller===1)?p.max:p.min;
  return {type:R.SELECT_CARD,indicies:(indices.length>=count?indices:cards.map((_,i)=>i)).slice(0,count)};
 }
 return null;
 });
 assert.equal(result,'STOPPED');assert.ok(practice.completed,`${lesson.id}: objetivo real`);assert.equal(duel.retriesTotal,0);assert.deepEqual(duel.errors,[]);console.log('✓ Phantom treino:',lesson.id);
 if(lesson.id==='rebeliao-sem-materiais-vira-requiem')assert.equal(practiceConditionMet({kind:'card',zone:'monsters',code:C.requiem,overlays:[C.launch]},{...initial,boards:[readBoardState(duel.core,duel.handle,0),null]}),false,'não certifica Réquiem sem Rebelião como material');
 }catch(e){console.error(JSON.stringify(trace.slice(-12),(_,v)=>typeof v==='bigint'?String(v):v));throw e;}finally{duel.destroy();}
}
assert.throws(()=>practiceSetup(deck,{startingHand:[],practice:{scenario:[{player:0,location:4,sequence:0,code:999999999}]}}),/inexistente/);
{
 const lesson=guide.lessons.find(l=>l.id==='espada-quebrada-abre-o-classe-4');
 assert.throws(()=>practiceSetup(deck,{...lesson,practice:{...lesson.practice,scenario:[{player:0,location:16,code:C.cloak},{player:0,location:16,code:C.cloak}]}}),/inexistente/,'cenário e mão não duplicam as duas cópias de Manto');
 assert.throws(()=>practiceSetup(deck,{...lesson,practice:{...lesson.practice,scenario:[{player:0,location:4,sequence:5,code:C.rusty},{player:1,location:4,sequence:6,code:C.rusty}]}}),/mesma zona/,'Zona Adicional compartilhada não comporta duas cartas');
}
