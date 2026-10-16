/** Executa os roteiros editoriais no core: recomendações devem permitir chegar aos objetivos reais. */
import assert from 'node:assert/strict';
import { OcgDuelMode, OcgMessageType as M, OcgResponseType as R, SelectIdleCMDAction as A } from '@n1xx1/ocgcore-wasm';
import { DECK_GUIDES } from '@/lib/data/deck-guides';
import { getPresetDeck } from '@/lib/data/preset-decks-catalog';
import { advancePractice, EMPTY_PRACTICE, practiceCardTargets } from '@/lib/duel/lesson-practice';
import { deckAfterOpeningHand } from '@/lib/duel/opening-hand';
import { createDuelSession } from '@/lib/duel/duel-session';
import { readBoardState } from '@/lib/duel/board-state';
import { createDuel, STOP, Zone } from './duel.mjs';

const actions = {
  thor: [['summons',13455953],['special_summons',90207654],['special_summons',30604579]],
  odin: [['summons',13455953],['special_summons',90207654],['special_summons',93483212]],
  loki: [['summons',13455953],['special_summons',90207654],['special_summons',67098114]],
  dystopia: [['summons',63060238],['activates',24094653],['activates',9411399]],
  'dark-law': [['summons',50720316],['activates',21143940]],
  plasma: [['summons',99357565],['activates',99357565],['special_summons',83965310]],
  'primeiro-xyz': [['summons',90432163],['special_summons',36426778],['special_summons',62709239]],
  'rusty-bardiche': [['summons',90432163],['special_summons',36426778],['special_summons',26692769],['activates',26692769],['activates',36426778]],
  leviair: [['activates',81439173],['activates',90432163],['summons',63821877],['special_summons',36426778],['special_summons',95992081],['activates',95992081],['activates',36426778]],
};
const actionType={summons:A.SELECT_SUMMON,special_summons:A.SELECT_SPECIAL_SUMMON,activates:A.SELECT_ACTIVATE};
for(const guide of DECK_GUIDES.filter(g=>g.id.startsWith('herois-lendarios-'))) for(const lesson of guide.lessons){
 const preset=getPresetDeck(guide.presetId);
 const duel=await createDuel({mode:OcgDuelMode.MODE_MR5,decks:[deckAfterOpeningHand(preset,lesson.startingHand,5).main,preset.main],place:[...lesson.startingHand.map(code=>({player:0,zone:Zone.HAND,code})),...preset.extra.map(code=>({player:0,zone:Zone.EXTRA,code}))]});
 let practice=EMPTY_PRACTICE, move=0, prompts=0;
 const initial=createDuelSession().getSnapshot(), trace=[];
 try {
  const outcome=duel.run(message=>{
   if(message.player!==0) return null;
   const snapshot={...initial,boards:[readBoardState(duel.core,duel.handle,0),null],lifePoints:[...duel.lifePoints],turnCount:1,turnPlayer:0,promptPlayer:0,pendingPrompt:message};
   practice=advancePractice(lesson,snapshot,practice);
   if(++prompts>200) throw Error('excesso de decisões');
   const targets=practiceCardTargets(lesson,snapshot,practice);
   trace.push(JSON.stringify({stage:practice.reached,message,targets},(_,v)=>typeof v==='bigint'?String(v):v));
   const recommended=c=>targets.some(t=>t.code===c.code && t.location===c.location && (t.controller??0)===c.controller);
   if(message.type===M.SELECT_IDLECMD){
    if(practice.completed) return STOP;
    const next=actions[lesson.id][move++];
    if(!next) return STOP;
    const [list,code]=next, index=message[list].findIndex(c=>c.code===code);
    assert.ok(index>=0,`ação ${list} ${code} disponível`);
    assert.ok(targets.some(t=>t.code===code),`GUIA indica ação ${code} na etapa ${practice.reached}`);
    return {type:R.SELECT_IDLECMD,action:actionType[list],index};
   }
   if(message.type===M.SELECT_CARD){
    const matches=message.selects.map((c,i)=>recommended(c)?i:-1).filter(i=>i>=0);
    const seen=new Set(), indicies=matches.filter(i=>{const code=message.selects[i].code;if(seen.has(code)) return false;seen.add(code);return true;}).slice(0,message.max);
    for(const i of matches) if(indicies.length<message.min && !indicies.includes(i)) indicies.push(i);
    assert.ok(indicies.length>=message.min,`GUIA oferece seleção suficiente (${indicies.length}/${message.min})`);
    return {type:R.SELECT_CARD,indicies};
   }
   if(message.type===M.SELECT_UNSELECT_CARD){
    const selected=new Set(message.unselect_cards.map(c=>c.code));
    let index=message.select_cards.findIndex(c=>recommended(c) && !selected.has(c.code));
    if(index<0 && !message.can_finish) index=message.select_cards.findIndex(recommended);
    if(message.can_finish && index<0) return {type:R.SELECT_UNSELECT_CARD,index:null};
    assert.ok(index>=0,'material indicado disponível');
    return {type:R.SELECT_UNSELECT_CARD,index};
   }
   if(message.type===M.SELECT_CHAIN){
    const index=message.selects.findIndex(recommended);
    return {type:R.SELECT_CHAIN,index:index>=0?index:message.forced?0:null};
   }
   return null;
  });
  assert.equal(outcome,'STOPPED');
  assert.ok(practice.completed,`objetivo alcançado: ${lesson.outcome}`);
  assert.equal(practice.reached,lesson.practice.stages.length);
  assert.equal(duel.retriesTotal,0,'sem decisões rejeitadas');
  assert.deepEqual(duel.errors,[]);
  console.log(`✓ ocgcore: ${guide.title} / ${lesson.title}`);
 }catch(error){
  if(process.env.DEBUG_GUIDES) console.error(trace.join('\n'));
  throw error;
 }finally{duel.destroy();}
}
