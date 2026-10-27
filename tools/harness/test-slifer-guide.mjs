/** Revisão do Slifer: lista real, sequência explícita e consequências no core. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OcgDuelMode, OcgMessageType as M, OcgResponseType as R, OcgLocation as L, OcgPosition as P, SelectIdleCMDAction as A } from '@n1xx1/ocgcore-wasm';
import { getDeckGuide } from '@/lib/data/deck-guides';
import { getPresetDeck } from '@/lib/data/preset-decks-catalog';
import { matchesGuideDeck } from '@/lib/domain/deck-guide';
import { readBoardState } from '@/lib/duel/board-state';
import { createDuel, autoPilot, STOP } from './duel.mjs';

const guide=getDeckGuide('tcg-egs1'),deck=getPresetDeck('tcg-egs1'),opponent=getPresetDeck('tcg-sdk');
const S=10000020,AH=86377375,COVIL=59160188,CROSS=5253985,REACTOR=79387392,ADVANCE=52112003,TRUE=39913299;
const THUNDER=42469671,SKY=12958919,PASS=93104632,VISHUDA=23431858,ENEMY=98045062,MARCH=19870120,DUKE=12766474;
const BLUE=89631139,OX=5053103;
assert.ok(matchesGuideDeck(guide,deck));assert.equal(guide.revision,2);assert.equal(guide.reviewedAt,'2026-10-27');
assert.equal(guide.difficulty,'Intermediário');assert.equal(guide.lessons.length,13);assert.equal(guide.decisions.length,8);
assert.equal(new Set(guide.keyCards.map(c=>c.code)).size,38);
assert.ok(guide.overview.strengths.length&&guide.overview.plan.length);
for(const lesson of guide.lessons) {
  assert.equal(lesson.practice,null);assert.equal(lesson.startingHand,null);
  assert.ok(lesson.steps.every(step=>step.why.length>20&&step.cardCodes.length),'raciocínio e cartas concretos em cada etapa');
}
assert.equal(guide.decisions.filter(d=>d.botEligible).length,1,'não automatiza situações que exigem sinais ainda não codificados');
const base=JSON.parse(readFileSync('src/data/deck-learning-base.json','utf8'));
assert.equal(base.decks.find(d=>d.id==='tcg-egs1').deckSnapshot.main.length,40);
const hints=JSON.parse(readFileSync('src/data/bot-guide-hints.json','utf8')).find(d=>d.id==='tcg-egs1');
assert.equal(hints.core.length,7,'analisar 38 cartas não transforma todas em prioridades de execução do bot');
console.log('✓ Slifer: 13 lições, 38 cartas, 8 decisões, revisão e raciocínios publicados');

const hand=(...codes)=>codes.map(code=>({player:0,zone:L.HAND,code}));
const monster=(code,player=0,sequence=0,position=P.FACEUP_ATTACK)=>({player,zone:L.MZONE,code,sequence,position});
const field=()=>({player:0,zone:L.SZONE,code:COVIL,sequence:5,position:P.FACEUP_ATTACK});
const activate=(code,index)=>({list:'activates',action:A.SELECT_ACTIVATE,code,effect:index});
const summon=code=>({list:'summons',action:A.SELECT_SUMMON,code});
function remaining(cards,placed,player) {
  const result=[...cards];for(const c of placed.filter(c=>c.player===player)) {
    const index=result.indexOf(c.code);assert.ok(index>=0,`cópia real na lista do assento ${player}: ${c.code}`);result.splice(index,1);
  } return result;
}
async function run(name,placed,moves,{select,inspect,endTurn=false,option}={}) {
  const duel=await createDuel({mode:OcgDuelMode.MODE_MR5,decks:[remaining(deck.main,placed,0),remaining(opponent.main,placed,1)],place:placed});
  let cursor=0,ended=false,knownTop=null;const trace=[];
  try {
    const result=duel.run(p=>{
      trace.push(p);
      if(p.type===M.SELECT_IDLECMD) {
        if(p.player===1)return STOP;
        const move=moves[cursor++];
        if(!move){inspect?.(p,duel);if(!endTurn||ended)return STOP;ended=true;return {type:R.SELECT_IDLECMD,action:A.TO_EP,index:null};}
        const index=p[move.list].findIndex(c=>c.code===move.code&&(move.effect===undefined||c.description===(BigInt(c.code)<<20n)+BigInt(move.effect)));
        assert.ok(index>=0,`${name}: ação ${move.code}/${move.effect??'*'} oferecida pelo motor`);
        return {type:R.SELECT_IDLECMD,action:move.action,index};
      }
      if(p.player!==0)return null;
      if(p.type===M.SELECT_OPTION&&option)return {type:R.SELECT_OPTION,index:option(p)};
      if(p.type===M.SELECT_CARD||p.type===M.SELECT_TRIBUTE) {
        const ranked=select?.(p,duel)??p.selects.map((c,index)=>({c,index}));
        const count=Math.min(p.max??p.selects.length,Math.max(p.min,1));
        return {type:p.type===M.SELECT_CARD?R.SELECT_CARD:R.SELECT_TRIBUTE,indicies:ranked.slice(0,count).map(item=>item.index)};
      }
      if(p.type===M.SELECT_UNSELECT_CARD) {
        if(p.can_finish)return {type:R.SELECT_UNSELECT_CARD,index:null};
        const preferred=select?.({...p,selects:p.select_cards},duel)?.[0];
        if(preferred)return {type:R.SELECT_UNSELECT_CARD,index:preferred.index};
        const index=p.select_cards.findIndex(c=>c.code!==SKY);
        return {type:R.SELECT_UNSELECT_CARD,index:index<0?0:index};
      }
      if(p.type===M.ANNOUNCE_NUMBER)return {type:R.ANNOUNCE_NUMBER,value:p.options.length-1};
      if(p.type===M.SORT_CARD){knownTop=p.cards[0].code;return {type:R.SORT_CARD,order:p.cards.map((_,i)=>i)};}
      if(p.type===M.ANNOUNCE_CARD){assert.ok(knownTop,'a declaração usa informação do topo visto');return {type:R.ANNOUNCE_CARD,card:knownTop};}
      return autoPilot(p,{db:duel.db});
    });
    assert.equal(result,'STOPPED',`${name}: laço conclui`);assert.equal(duel.retriesTotal,0,`${name}: sem RETRY`);
    assert.deepEqual(duel.errors,[],`${name}: sem erro de script`);
    const board=readBoardState(duel.core,duel.handle,0,false);
    assert.ok(cursor>=moves.length,`${name}: sequência completa`);
    console.log(`✓ core: ${name}`);return {board,trace,messages:duel.messages};
  }catch(error){if(process.env.DEBUG_SLIFER)console.log(trace.map(p=>JSON.stringify(p,(_,v)=>typeof v==='bigint'?String(v):v)).join('\n'));throw error;}
  finally{duel.destroy();}
}
const choose=(p,predicate)=>p.selects.map((c,index)=>({c,index})).sort((a,b)=>Number(predicate(b.c))-Number(predicate(a.c)));
{
  const {board}=await run('duas cópias de Ahrima: busca, Covil, Tributo adversário e Vishuda',
    [...hand(AH,AH,S,ADVANCE,THUNDER),monster(BLUE,1)],
    [activate(AH,0),activate(COVIL),summon(AH),activate(AH,1)],
    {select:p=>{
      if(p.selects.every(c=>c.location===L.DECK))assert.deepEqual(new Set(p.selects.map(c=>c.code)),new Set([DUKE,VISHUDA]),'Ahrima só busca os TREVAS com DEF suficiente da lista');
      return choose(p,c=>c.controller===1||c.code===VISHUDA);
    }});
  assert.ok(board.players[0].monsters.some(c=>c?.code===AH),'Ahrima preservado');
  assert.ok(board.players[1].grave.some(c=>c.code===BLUE),'ameaça paga como custo');
  assert.ok(board.players[0].hand.some(c=>c.code===VISHUDA),'alvo TREVAS/DEF correto buscado');
}
{
  const {board}=await run('Covil + Controlador: paga um adversário e toma outro',
    [...hand(ENEMY,S,ADVANCE,THUNDER,MARCH),field(),monster(BLUE,1),monster(OX,1,1)],
    [activate(ENEMY)],{option:()=>1,select:p=>choose(p,c=>c.controller===1&&c.code===BLUE)});
  assert.ok(board.players[0].monsters.some(c=>c?.code===OX));assert.ok(board.players[1].grave.some(c=>c.code===BLUE));
}
{
  const {board}=await run('Reator + Avanço: Slifer por Tributo no primeiro turno',
    hand(REACTOR,ADVANCE,S,THUNDER,MARCH),[activate(ADVANCE),summon(REACTOR),activate(REACTOR,0),summon(S)]);
  const slifer=board.players[0].monsters.find(c=>c?.code===S);assert.ok(slifer);assert.equal(slifer.attack,2000);
  assert.equal(board.players[0].monsters.filter(Boolean).length,1);
}
await run('três corpos sem Avanço não concedem outra Normal',hand(REACTOR,S,THUNDER,MARCH,AH),[summon(REACTOR),activate(REACTOR,0)],
  {inspect:p=>assert.ok(!p.summons.some(c=>c.code===S))});
{
  const {board}=await run('Ficha prévia + Skyblaster + Avanço: sobra um corpo',
    hand(PASS,SKY,ADVANCE,S,THUNDER),[activate(PASS),summon(SKY),activate(ADVANCE),summon(S)],
    {select:p=>choose(p,c=>c.code!==SKY)});
  assert.ok(board.players[0].monsters.some(c=>c?.code===S));assert.equal(board.players[0].monsters.filter(Boolean).length,2);
}
{
  const {board}=await run('Cruzar Almas usa três adversários sem depender de Covil',
    [...hand(CROSS,S,THUNDER,MARCH,ADVANCE),monster(BLUE,1),monster(OX,1,1),monster(76184692,1,2)],
    [activate(CROSS)],{select:p=>choose(p,c=>c.code===S||c.controller===1)});
  assert.ok(board.players[0].monsters.some(c=>c?.code===S));assert.equal(board.players[1].monsters.filter(Boolean).length,0);
}
{
  const {board,messages}=await run('Avanço + Nome Verdadeiro: declaração informada e Slifer Especial sai na Fase Final',
    hand(ADVANCE,TRUE,THUNDER,MARCH,AH),[activate(ADVANCE),activate(TRUE)],
    {select:p=>choose(p,c=>c.code===S),option:()=>1,endTurn:true});
  assert.ok(board.players[0].grave.some(c=>c.code===S));assert.ok(!board.players[0].monsters.some(c=>c?.code===S));
  assert.ok(messages.some(m=>m.type===M.SPSUMMONING&&m.code===S),'Slifer realmente entrou por Especial antes de sair');
}
await run('Covil sozinho não permite a Normal de Slifer com adversários',
  [...hand(S,THUNDER,MARCH,ADVANCE,AH),field(),monster(BLUE,1),monster(OX,1,1),monster(76184692,1,2)],[],
  {inspect:p=>assert.ok(!p.summons.some(c=>c.code===S))});
{
  const {board}=await run('Covil repõe a Ficha no campo do jogador do turno',
    [...hand(S,THUNDER,MARCH,ADVANCE,ENEMY),field(),monster(AH),monster(BLUE,1)],
    [activate(AH,1)],{select:p=>choose(p,c=>c.controller===1||c.code===VISHUDA),endTurn:true});
  assert.ok(board.players[0].monsters.some(c=>c?.code===59160189));
  assert.ok(!board.players[1].monsters.some(c=>c?.code===59160189));
}
await run('Duke após Ficha de Segurança sob Covil',
  [...hand(PASS,DUKE,S,THUNDER,ADVANCE),field(),monster(BLUE,1)],[activate(PASS)],
  {inspect:p=>assert.ok(p.activates.some(c=>c.code===DUKE),'Ficha entrou como TREVAS sob Covil já ativo')});
await run('sem Covil, Ficha LUZ anterior impede o efeito de Duke',
  [...hand(PASS,DUKE,S,THUNDER,ADVANCE),monster(AH)],[activate(PASS)],
  {inspect:p=>assert.ok(!p.activates.some(c=>c.code===DUKE))});
await run('ativar Covil depois da Ficha não apaga o histórico LUZ',
  hand(PASS,COVIL,DUKE,S,ADVANCE),[activate(PASS),activate(COVIL)],
  {inspect:p=>assert.ok(!p.activates.some(c=>c.code===DUKE))});
await run('o bloqueio de Duke impede novas Fichas LUZ mesmo com Covil ativo',
  [...hand(PASS,DUKE,S,THUNDER,ADVANCE),field(),monster(BLUE,1)],[activate(DUKE)],
  {select:p=>choose(p,c=>c.controller===1),inspect:p=>assert.ok(!p.activates.some(c=>c.code===PASS))});
{
  const {board}=await run('Duke recupera Vishuda do Cemitério após usar um adversário',
    [...hand(DUKE,S,THUNDER,MARCH,ADVANCE),field(),{player:0,zone:L.GRAVE,code:VISHUDA},monster(BLUE,1)],
    [activate(DUKE)],{select:p=>choose(p,c=>c.controller===1||c.code===VISHUDA)});
  assert.ok(board.players[0].monsters.some(c=>c?.code===DUKE));assert.ok(board.players[0].hand.some(c=>c.code===VISHUDA));
  assert.ok(board.players[1].grave.some(c=>c.code===BLUE));
}
