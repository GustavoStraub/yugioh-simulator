/** Casos dirigidos com objetivos e alternativas; baseline medida, sem alegar origem em derrotas reais. */
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { OcgMessageType as M, OcgLocation as L, OcgPosition as P, SelectIdleCMDAction as A, SelectBattleCMDAction as B } from '@n1xx1/ocgcore-wasm';
import { BotBrain } from '@/lib/duel/bot/bot-brain';
import { BotKnowledge } from '@/lib/duel/bot/knowledge';
import { responseHypotheses } from '@/lib/duel/bot/evaluator';
import { effectModel } from '@/lib/duel/bot/effect-model';
import { planBattle } from '@/lib/duel/bot/battle-planner';
import { BOT_POLICIES } from '@/lib/duel/bot/difficulty';
import { validBotResponse } from '@/lib/duel/bot/response-validator';
import { loadBotProfile } from '@/lib/duel/bot/deck-profile';
import { getPresetDeck } from '@/lib/data/preset-decks-catalog';
import { OfficialCardDb } from '@/lib/duel/official-card-data';
import { loadBaseline, stringify, hash, parse } from './bot-evaluation-artifacts.mjs';
import { BotPlanner } from '@/lib/duel/bot/planner';
import { pairedInterval, pairedDifference, scoreGames, approval } from './bot-evaluation-protocol.mjs';

const frozen = await loadBaseline('tools/harness/baselines/2026-10-23');
const db = new OfficialCardDb(JSON.parse(readFileSync('src/data/card-db.json','utf8')));
const empty=()=>({monsters:Array(7).fill(null),spells:Array(6).fill(null),field:null,hand:[],grave:[],banished:[],extra:[],deckSize:40,graveSize:0,banishedSize:0,extraSize:0,extraFaceUp:0,graveTop:null});
const card=(code,location=L.HAND,sequence=0,controller=0,defense=false)=>({code,location,sequence,controller,position:defense?P.FACEUP_DEFENSE:P.FACEUP_ATTACK,faceDown:false,defense,attack:db.get(code)?.atk??0,defenseValue:db.get(code)?.def??0,counters:[],overlays:[],negated:false});
const idle=()=>({type:M.SELECT_IDLECMD,player:0,summons:[],special_summons:[],monster_sets:[],spell_sets:[],pos_changes:[],activates:[],to_ep:true,to_bp:false,shuffle:false});
const context=(prompt,board={players:[empty(),empty()]})=>({prompt,me:0,readBoard:()=>board,cardDb:db,lifePoints:[8000,8000],phase:4,turnPlayer:0,turnCount:1,format:'tcg',chainOpen:false});
const results=[];
async function scenario(id,category,objective,make,acceptable,consequence) {
  const run=async(Brain,profiles)=> {
    const {ctx,deckId,config={}}=make(); const deck=deckId?getPresetDeck(deckId):undefined;
    const brain=new Brain({difficulty:'hard',candidateComparison:true,seed:31,deck,format:'tcg',profile:deck?await profiles(deck,'tcg'):null,...config});
    const response=brain.decide(ctx);
    return {accepted:acceptable(response,ctx,brain),response,source:brain.lastTrace?.source,
      reason:brain.lastTrace?.reason,trace:brain.lastTrace};
  };
  const before=await run(frozen.brain.BotBrain,frozen.profiles.loadBotProfile), after=await run(BotBrain,loadBotProfile);
  assert.ok(after.accepted,`${id}: ${objective}; recebido ${stringify(after.response)}`);
  assert.ok(after.trace.source,`${id}: origem final`);
  assert.ok(after.trace.candidates.some(candidate=>candidate.id===after.trace.selected),`${id}: candidato final rastreável`);
  const {ctx}=make(); assert.ok(validBotResponse(ctx.prompt,after.response,db),`${id}: contrato`);
  delete before.trace; delete after.trace;
  results.push({id,category,objective,consequence,evidence:'observação dirigida; resultado estratégico ainda precisa de confirmação no core',before,after});
}
const chainCase=(responseCode,chainCode,index,life=8000,pressure=0)=>()=> {
  const board={players:[empty(),empty()]}; board.players[0].hand=[card(responseCode)];
  if(pressure) board.players[1].monsters[0]={...card(90432163,L.MZONE,0,1),attack:pressure};
  const prompt={type:M.SELECT_CHAIN,player:0,selects:[{...card(responseCode),description:BigInt(responseCode)<<20n}],forced:false,special_count:0,hint_timing:0,other_timing:0};
  return {ctx:{...context(prompt,board),turnPlayer:1,chainPlayer:1,chainCode,chainOpen:Boolean(chainCode),lifePoints:[life,8000],
    chainEffect:chainCode?{code:chainCode,player:1,description:(BigInt(chainCode)<<20n)+BigInt(index),link:1,negated:false}:null}};
};
await scenario('timing-veiler-buff','timing','Guardar Veiler contra aumento de atributos sem risco imediato',chainCase(97268402,90432163,0),r=>r.index===null,'Veiler permanece na mão para uma busca posterior');
await scenario('timing-veiler-busca','timing','Negar a busca do mesmo Manto Antigo',chainCase(97268402,90432163,1),r=>r.index===0,'A mesma carta recebe avaliação diferente por efeito');
await scenario('timing-ash-compra','timing','Guardar Ash contra compra de impacto baixo no modelo',chainCase(14558127,1475311,0),r=>r.index===null,'Preserva uma resposta para a extensão conhecida');
await scenario('timing-ash-fusao','timing','Negar Fusão do Marcado',chainCase(14558127,44362883,0),r=>r.index===0,'Interrompe acesso à Fusão');
await scenario('timing-ash-botas','timing','Negar a busca das Botas no cemitério',chainCase(14558127,36426778,1),r=>r.index===0,'Impede acesso à armadilha');
await scenario('timing-veiler-janela','timing','Não gastar Veiler em janela livre sem efeito adversário',chainCase(97268402,null,0),r=>r.index===null,'A janela legal sozinha não justifica o custo');
await scenario('timing-veiler-letal','timing','Gastar Veiler contra buff que ameaça letal',chainCase(97268402,90432163,0,2500,2000),r=>r.index===0,'A urgência supera o valor de guardar');
await scenario('timing-proprio-elo','timing','Não negar o próprio elo',()=>{const x=chainCase(14558127,44362883,0)();x.ctx.chainPlayer=0;return x;},r=>r.index===null,'Preserva a própria Fusão');

for(const [id,deckId,duplicate,missing] of [
  ['pk-luva-manto','tcg-lehd-phantom-knights',63821877,90432163],
  ['aesir-vanadis-guldfaxe','tcg-lehd-aesir',61777313,41788781],
  ['aesir-tyr-guldfaxe','tcg-lehd-aesir',76348260,41788781],
]) for(const reversed of [false,true]) await scenario(`busca-${id}-${Number(reversed)}`,'busca','Buscar acesso ausente em vez de repetir uma peça já na mão',()=> {
  const board={players:[empty(),empty()]};board.players[0].hand=[card(duplicate)];
  const codes=reversed?[missing,duplicate]:[duplicate,missing];
  const effect=deckId.includes('aesir')?14464864:32807846;
  return {deckId,ctx:{...context({type:M.SELECT_CARD,player:0,min:1,max:1,can_cancel:false,selects:codes.map((code,i)=>card(code,L.DECK,i))},board),
    resolvingEffect:{code:effect,description:BigInt(effect)<<20n,player:0,link:1,negated:false}}};
},(r,c)=>c.prompt.selects[r.indicies[0]].code===missing,'Mantém duas funções diferentes na mão; a ordem do prompt não muda o objetivo');

for(const [id,opponent,life,expected] of [
  ['mesa-pronta',1000,8000,'hold'],['mesa-vazia',0,8000,'hold'],['extensao-letal',0,4000,'summon'],['ataque-ameacador',3500,8000,'act'],
]) await scenario(`recursos-${id}`,'extensão','Comparar guardar recursos com desenvolver a mesa',()=> {
  const board={players:[empty(),empty()]};board.players[0].monsters[0]=card(44146295,L.MZONE);
  board.players[0].hand=[card(45484331),card(97268402,L.HAND,1)];
  if(opponent) board.players[1].monsters[0]={...card(89631139,L.MZONE,0,1),attack:opponent};
  return {deckId:'tcg-sdaz',ctx:{...context({...idle(),summons:[card(45484331)],to_bp:true},board),lifePoints:[8000,life]}};
},r=>expected==='hold'?[A.TO_BP,A.TO_EP].includes(r.action):r.action===A.SELECT_SUMMON,'Guardar precisa de defesa existente; letal e risco de derrota são casos opostos');

for(const code of [23205979,31305911]) for(const negated of [false,true]) await scenario(`combate-${code}-${Number(negated)}`,'combate','Respeitar proteção de batalha e sua negação',()=> {
  const board={players:[empty(),empty()]};board.players[0].monsters[0]=card(89631139,L.MZONE);
  board.players[1].monsters[0]={...card(code,L.MZONE,0,1,true),negated};
  return {ctx:{...context({type:M.SELECT_BATTLECMD,player:0,attacks:[{...card(89631139,L.MZONE),can_direct:false}],chains:[],to_m2:true,to_ep:true},board),lifePoints:[8000,1000]}};
},r=>r.action===(negated?B.SELECT_BATTLE:B.TO_M2),'Uma defesa indestrutível continua bloqueando o dano direto');

for(const [id,codes,expected] of [
  ['starter-duplicado',[45484331,45484331,97268402],45484331],
  ['starter-unico',[45484331,97268402],97268402],
  ['fusao-unica',[44362883,97268402],97268402],
  ['material-redundante',[97268402,97268402,44362883],97268402],
]) await scenario(`descarte-${id}`,'descarte','Conservar o único acesso e gastar recurso redundante',()=> {
  const board={players:[empty(),empty()]};board.players[0].hand=codes.map((code,i)=>card(code,L.HAND,i));
  return {deckId:'tcg-sdaz',ctx:context({type:M.SELECT_CARD,player:0,min:1,max:1,can_cancel:false,selects:board.players[0].hand},board)};
},(r,c)=>c.prompt.selects[r.indicies[0]].code===expected,'O descarte deixa acesso ao motor na mão');

// Memória: evidência pública afeta hipóteses sem ler identidades da mão oculta.
for(const [id,facts,expected] of [
  ['conhecida',[{code:14558127,player:1,seenTurn:1,place:'1:2:0'}],'known'],
  ['vista',[{code:14558127,player:1,seenTurn:1,place:null}],'seen'],
  ['sem-evidencia',[],'possible'],
  ['outra-carta',[{code:89631139,player:1,seenTurn:1,place:'1:2:0'}],'possible'],
]) {
  const board={players:[empty(),empty()]};board.players[1].hand=[{...card(null,L.HAND,0,1),faceDown:true}];
  const hypotheses=responseHypotheses({...context(idle(),board),observedFacts:facts});
  assert.ok(hypotheses.some(h=>h.confidence===expected));
  results.push({id:`memoria-${id}`,category:'memória',objective:`Distinguir evidência ${expected}`,after:{accepted:true},
    evidence:'teste de observação pública; não é falha de partida atribuída'});
}
assert.equal(results.length,30);
{
  const brain=new BotBrain({difficulty:'hard'});
  const c={...context({type:M.SELECT_CHAIN,player:0,selects:[],forced:false}),readBoard(){throw new Error('automático não precisa consultar campo');}};
  brain.decide(c);assert.equal(brain.lastTrace.source,'automatic');
  brain.decide({...context(idle()),readBoard(){throw new Error('falha injetada');}});
  assert.equal(brain.lastTrace.source,'fallback-error');assert.ok(brain.lastTrace.replacement);
  const options=context({type:M.SELECT_OPTION,player:0,options:[100n,101n]});
  brain.decide(options);assert.equal(brain.lastTrace.source,'fallback-unmodeled');
  const recovered=brain.decide({...options,retryCount:1});
  assert.equal(brain.lastTrace.source,'rejected-recovery');assert.equal(recovered.index,1);
}
// Primeira divergência real inspecionada nos replays. Ter um boss não basta
// para parar: a mão precisa conservar uma continuação utilizável.
{
  const fixture=parse(readFileSync('tools/harness/fixtures/bot-over-preservation.json','utf8'));
  const o=fixture.observation, deck=getPresetDeck('tcg-sdaz');
  const brain=new BotBrain({difficulty:'hard',candidateComparison:true,deck,format:'tcg',profile:await loadBotProfile(deck,'tcg')});
  const response=brain.decide({...context(o.prompt,o.board),me:o.me,turnPlayer:o.me,turnCount:2,lifePoints:o.lifePoints,phase:o.phase});
  assert.equal(response.action,fixture.expected.action);
  assert.equal(o.prompt.special_summons[response.index].code,fixture.expected.code);
}
// Viabilidade/valor vêm antes do corte; objetivos conservam somente recursos ainda acessíveis.
{
  const deck=getPresetDeck('tcg-sdaz'), profile=await loadBotProfile(deck,'tcg');
  const board={players:[empty(),empty()]};
  board.players[0].hand=[44362883,10813327,97268402,24224830,59919307].map((code,i)=>card(code,L.HAND,i));
  board.players[0].extra=deck.extra.map((code,i)=>card(code,L.EXTRA,i));
  const base=profile.routes.find(route=>route.id==='primeira-fusao');
  const low={...base,id:'low',result:{...base.result,pressure:100}}, high={...base,id:'high',result:{...base.result,pressure:8000}};
  const planner=new BotPlanner({...profile,routes:[low,high]},deck);
  const c=context({...idle(),activates:[card(44362883)]},board);
  planner.observe(c,{...BOT_POLICIES.hard,alternatives:1},performance.now()+100);
  assert.equal(planner.route.id,'high','corte não depende da ordem do JSON');
  planner.stepIndex=planner.route.steps.length;
  planner.observe({...c,prompt:idle()},BOT_POLICIES.hard,performance.now()+100);
  const reserves=[...planner.reserves]; assert.ok(reserves.length);
  planner.observe({...c,prompt:idle(),turnCount:2,turnPlayer:1},BOT_POLICIES.hard,performance.now()+100);
  assert.ok(planner.reserves.some(code=>reserves.includes(code)),'reserva acessível sobrevive à troca de turno');
  board.players[0].hand=[];
  planner.observe({...c,prompt:idle(),turnCount:3,turnPlayer:1},BOT_POLICIES.hard,performance.now()+100);
  assert.equal(planner.reserves.length,0,'não inventa recurso perdido');
}
assert.equal(effectModel(90432163,(90432163n<<20n)+0n).kind,'boost');
assert.equal(effectModel(90432163,(90432163n<<20n)+1n).kind,'search');
assert.equal(effectModel(90432163,221n),null,'descrição genérica não identifica efeito');
// A mesma observação permitida deve gerar a mesma resposta.
{
  const observations=[14558127,89631139].map(hidden=>{
    const data=chainCase(97268402,90432163,0)();data.ctx.readBoard(true).players[1].hand=[card(hidden,L.HAND,0,1)];
    return new BotBrain({difficulty:'hard',seed:37}).decide(data.ctx);
  });
  assert.deepEqual(observations[0],observations[1]);
  const knowledge=new BotKnowledge(0);knowledge.observe({type:M.CONFIRM_CARDS,player:0,cards:[card(14558127,L.HAND,0,1)]});
  knowledge.observe({type:M.SHUFFLE_HAND,player:1,cards:[]});
  assert.equal(knowledge.context().observedFacts[0].place,null);
}
// Duas vitórias do mesmo par ficam juntas: reamostrar partidas separadas produziria IC diferente.
{
  const games=Array.from({length:8},(_,i)=>({pair:`p${Math.floor(i/2)}`,seat:i%2,decks:['a','b'],score:i<4?1:0,rejected:0,errors:0,limits:0}));
  assert.deepEqual(pairedInterval(games),[0,1]);
  assert.equal(scoreGames([...games,{score:0.5},{score:null}]).score,0.5);
  assert.equal(approval(games,'development').approved,false);
  assert.equal(pairedInterval(games.slice(0,2)),null);
  assert.deepEqual(pairedDifference(games,games).ci95,[0,0],'mesmos pares nas duas políticas');
  assert.ok(approval(games,'development',games).deckResults.every(deck=>deck.reviewRequired===false),'força do deck por si só não é regressão da política');
  assert.ok(approval(games,'validation',games.slice(0,2)).deckResults.some(deck=>deck.reviewRequired===null),'controle parcial não permite aprovar regressões por deck');
}
// Uma análise com orçamento vencido ainda retorna a melhor ação examinada.
{
  const board={players:[empty(),empty()]};board.players[0].monsters[0]=card(89631139,L.MZONE);
  const c=context({type:M.SELECT_BATTLECMD,player:0,attacks:[{...card(89631139,L.MZONE),can_direct:true}],chains:[],to_m2:true,to_ep:true},board);
  assert.ok(planBattle(c.prompt,c,BOT_POLICIES.hard,-Infinity));
}
mkdirSync('.cache/bot-evaluation',{recursive:true});
const output={schema:1,kind:'directed-observations',baseline:frozen.hash,cases:results,
  measuredRegressions:results.filter(r=>r.before&&!r.before.accepted).length,
  fixed:results.filter(r=>r.before&&!r.before.accepted&&r.after.accepted).length};
writeFileSync('.cache/bot-evaluation/evolution-decisions.json',JSON.stringify(output,null,2)+'\n');
console.log(`✓ ${results.length} casos dirigidos; ${output.fixed}/${output.measuredRegressions} divergências da baseline corrigidas`);
console.log(`✓ grafo isolado ${hash(stringify(frozen.manifest.files)).slice(0,12)}, fontes finais, pares, identidade de efeito, informação oculta e orçamento`);
