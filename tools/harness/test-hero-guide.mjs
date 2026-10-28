import assert from 'node:assert/strict';
import {OcgDuelMode,OcgMessageType as M,OcgResponseType as R,SelectIdleCMDAction as A} from '@n1xx1/ocgcore-wasm';
import {getDeckGuide} from '@/lib/data/deck-guides';
import {getPresetDeck} from '@/lib/data/preset-decks-catalog';
import {readBoardState} from '@/lib/duel/board-state';
import {createDuelSession} from '@/lib/duel/duel-session';
import {advancePractice,EMPTY_PRACTICE,practiceCardTargets,practiceConditionMet} from '@/lib/duel/lesson-practice';
import {deckAfterOpeningHand} from '@/lib/duel/opening-hand';
import {createDuel,STOP,Zone as L} from './duel.mjs';
const guide=getDeckGuide('herois-lendarios-destiny-hero'),deck=getPresetDeck(guide.presetId);
const moves={
'dizimador-altera-distopia':[[63060238,'summons'],[24094653],[9411399],[83764718],[63813056,'special_summons']],
'destiny-draw-transforma-malicious-em-desenvolvimento':[[45809008],[9411399]],
'blazeman-envia-nevoa-e-renasce':[[63060238,'summons'],[63060238],[21143940]],
'perigoso-prepara-malicioso':[[24094653],[30757127],[9411399]],
'dynatag-habilita-a-destruicao-de-dystopia':[[75041269],[24094653],[37780349],[90579153]],
'wonder-driver-recupera-a-magia-usada':[[91691605,'summons'],[1948619,'special_summons'],[9411399],[24094653],[83764718]],
'over-destiny-completa-plasma':[[24094653],[72204747],[9411399],[83965310,'special_summons']],
'dragao-final-sem-tres-tributos':[[24094653]],
'dusktopia-recicla-fusao':[[24094653],[24094653]],
};
for(const lesson of guide.lessons.filter(l=>moves[l.id])){
 const duel=await createDuel({mode:OcgDuelMode.MODE_MR5,decks:[deckAfterOpeningHand(deck,lesson.startingHand,5).main,deck.main],place:[...lesson.startingHand.map(code=>({player:0,zone:L.HAND,code})),...deck.extra.map(code=>({player:0,zone:L.EXTRA,code}))]});
 let move=0,active=0,practice=EMPTY_PRACTICE;const trace=[],initial=createDuelSession().getSnapshot();
 try{
 duel.run(p=>{
 if(p.player!==0)return null;
 const snapshot={...initial,boards:[readBoardState(duel.core,duel.handle,0),null],lifePoints:[...duel.lifePoints],turnCount:1,turnPlayer:0,promptPlayer:0,pendingPrompt:p};practice=advancePractice(lesson,snapshot,practice);
 trace.push(p);
 if(p.type===M.SELECT_IDLECMD){
  // Dusktopia's final effect has no observable card-zone change; still execute it before stopping.
  const m=moves[lesson.id][move++];if(!m)return STOP;
  const [code,list='activates']=m;active=code;const index=p[list].findIndex(c=>c.code===code);assert.ok(index>=0,`${lesson.id}: ${list} ${code}`);
  assert.ok(practiceCardTargets(lesson,snapshot,{...practice,completed:false}).some(t=>t.code===code)||code===93657021,'ação ensinada indicada');
  return {type:R.SELECT_IDLECMD,index,action:({activates:A.SELECT_ACTIVATE,summons:A.SELECT_SUMMON,special_summons:A.SELECT_SPECIAL_SUMMON,spell_sets:A.SELECT_SPELL_SET})[list]};
 }
 if(p.type===M.SELECT_EFFECTYN){const yes=!(lesson.id.startsWith('blazeman-')&&p.code===63060238);if(yes)active=p.code;return {type:R.SELECT_EFFECTYN,yes};}
 if(p.type===M.SELECT_YESNO)return {type:R.SELECT_YESNO,yes:false};
 if(p.type===M.SELECT_CHAIN)return {type:R.SELECT_CHAIN,index:null};
 if(p.type===M.SELECT_PLACE){
  // Wonder Driver in left EMZ (5) points to own main zone 1; keep Dystopia elsewhere.
  const zone=active===1948619||active===63813056?5:active===83764718&&lesson.id.startsWith('wonder-')?1:0;
  if((p.field_mask& (1<<zone))===0)return {type:R.SELECT_PLACE,places:[{player:0,location:L.MZONE,sequence:zone}]};
 }
 if(p.type===M.SELECT_CARD||p.type===M.SELECT_UNSELECT_CARD){
  const cards=p.type===M.SELECT_CARD?p.selects:p.select_cards;
  if(p.type===M.SELECT_UNSELECT_CARD&&p.can_finish)return {type:R.SELECT_UNSELECT_CARD,index:null};
  let want=[];
  if(cards.some(c=>c.location===L.EXTRA))want=[active===21143940?58481572:lesson.id.startsWith('perigoso-')?30757127:lesson.id.startsWith('dragao-')?76263644:lesson.id.startsWith('dusktopia-')&&move===2?93657021:90579153];
  else if(active===45809008)want=[9411399];
  else if(active===21143940)want=[63060238];
  else if(active===63060238)want=[50720316];
  else if(cards.every(c=>c.location===L.DECK))want=active===30757127?[9411399]:active===72204747?[66262416]:[91691605,9411399];
  else if(active===30757127)want=[35787450,9411399];
  else if(active===83764718)want=lesson.id==='dizimador-altera-distopia'?[63362460]:[91691605];
  else if(active===37780349)want=[90579153];
  else if(active===90579153)want=cards.every(c=>c.location===L.GRAVE)?[63362460]:[75041269];
  else if(active===72204747)want=[9411399];
  else if(cards.every(c=>c.location===L.GRAVE))want=[63362460,24094653];
  else if(active===24094653)want=lesson.id.startsWith('dusktopia-')&&move===2?[90579153,9411399]:[63362460,37780349,9411399,91691605,83965310,17132130];
  else want=[9411399,63060238,63362460,91691605,24094653];
  const ranked=cards.map((c,i)=>({i,n:want.indexOf(c.code)})).filter(x=>x.n>=0).sort((a,b)=>a.n-b.n).map(x=>x.i);
  if(p.type===M.SELECT_UNSELECT_CARD)return {type:R.SELECT_UNSELECT_CARD,index:ranked[0]??0};
  return {type:R.SELECT_CARD,indicies:(ranked.length>=p.min?ranked:cards.map((_,i)=>i)).slice(0,p.min)};
 }
 return null;
 });
 assert.ok(practice.completed,`${lesson.id}: objetivo real`);
 if(lesson.id==='dizimador-altera-distopia')assert.equal(practiceConditionMet({kind:'card',zone:'monsters',code:90579153,attack:2800},{...initial,boards:[readBoardState(duel.core,duel.handle,0),null]}),false,'Distopia com ATK errado não satisfaz o treino');assert.equal(duel.retriesTotal,0);assert.deepEqual(duel.errors,[]);console.log('✓ HERO treino:',lesson.id);
 }catch(e){console.error(trace.slice(-12));throw e;}finally{duel.destroy();}
}
