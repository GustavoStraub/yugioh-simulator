/** Regressões estratégicas: informação, custos alternativos, negação e recursos. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OcgMessageType as M,OcgResponseType as R,OcgLocation as L,OcgPosition as P,SelectIdleCMDAction as A } from '@n1xx1/ocgcore-wasm';
import { BotBrain } from '@/lib/duel/bot/bot-brain';
import { BOT_POLICIES } from '@/lib/duel/bot/difficulty';
import { BotPlanner } from '@/lib/duel/bot/planner';
import { profileResponse } from '@/lib/duel/bot/effect-handlers';
import { guideHintsForDeck } from '@/lib/duel/bot/guide-hints';
import { decisionApplies, decisionEffectTarget, decisionMoves, sequenceFollowUp } from '@/lib/duel/bot/decision-policy';
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
const editorial=JSON.parse(readFileSync('src/data/deck-learning-base.json','utf8'));
const authoredDecisions=JSON.parse(readFileSync('src/data/guide-decisions.json','utf8'));
const registry=CardRegistry.fromCatalog(JSON.parse(readFileSync('.cache/catalog/catalog.json','utf8')));
import { nodeAssets } from '@/server/duel/node-assets';
const deck=getPresetDeck('tcg-sdaz'), profile=await loadBotProfile(deck,'tcg');
const empty=()=>({monsters:Array(7).fill(null),spells:Array(6).fill(null),field:null,hand:[],grave:[],banished:[],extra:[],deckSize:40,graveSize:0,banishedSize:0,extraSize:0,extraFaceUp:0,graveTop:null});
const card=(code,location=L.HAND,sequence=0,controller=0)=>({code,location,sequence,controller,position:P.FACEUP_ATTACK,faceDown:false,defense:false,attack:db.get(code)?.atk??0,defenseValue:db.get(code)?.def??0,counters:[],negated:false});
const ctx=(prompt,board={players:[empty(),empty()]})=>({prompt,me:0,readBoard:()=>board,cardDb:db,lifePoints:[8000,8000],phase:4,turnPlayer:0,turnCount:1,format:'tcg',chainOpen:false});
const idle=(cards=[])=>({type:M.SELECT_IDLECMD,player:0,summons:[],special_summons:[],monster_sets:[],spell_sets:[],pos_changes:[],activates:cards,to_ep:true,to_bp:false,shuffle:false});
const select=(cards,min=1,max=1)=>({type:M.SELECT_CARD,player:0,min,max,can_cancel:false,selects:cards});
{
  for(const guide of editorial.decks){
    const hints=guideHintsForDeck({...guide.deckSnapshot,format:'tcg'},'tcg');
    assert.equal(hints?.id,guide.id,`índice do bot atualizado para ${guide.id}`);
    assert.deepEqual(hints?.decisions,authoredDecisions[guide.id]??[],`cenários de decisão disponíveis no índice: ${guide.id}`);
  }
  console.log(`✓ prioridades sincronizadas com ${editorial.decks.length} guias`);
}
{
  const openings=[
    {id:'tcg-sr06',decision:'ahrima-busca-covil',hand:[86377375],action:A.SELECT_ACTIVATE,code:86377375,target:59160188},
    {id:'tcg-sdbt',decision:'myrmeleo-encontra-holeutea',hand:[91812341],action:A.SELECT_SUMMON,code:91812341,target:74577599,extra:[73639099]},
    {id:'tcg-sr14',decision:'ponix-encontra-santuario',hand:[90681088],action:A.SELECT_SUMMON,code:90681088,target:65305978},
    {id:'tcg-sdcs',decision:'claw-encontra-realm',hand:[82562802],action:A.SELECT_ACTIVATE,code:82562802,target:64753988},
    {id:'tcg-l26d-x-saber',decision:'boggart-abre-faultroll',hand:[5998840,31383545,51808422],action:A.SELECT_SUMMON,code:5998840,target:31383545},
    {id:'tcg-sr04',decision:'oviraptor-encontra-tyranno',hand:[44335251],grave:[36042004,82946847],action:A.SELECT_SUMMON,code:44335251,target:18940556},
    {id:'tcg-sdrr',decision:'quick-launch-encontra-tracer',hand:[31443476],action:A.SELECT_ACTIVATE,code:31443476,target:68464358},
  ];
  for(const opening of openings){
    const ownDeck=getPresetDeck(opening.id),guide=guideHintsForDeck(ownDeck,'tcg');
    const board={players:[empty(),empty()]};
    board.players[0].hand=opening.hand.map((code,index)=>card(code,L.HAND,index));
    board.players[0].grave=(opening.grave??[]).map((code,index)=>card(code,L.GRAVE,index));
    board.players[0].extra=(opening.extra??[]).map((code,index)=>card(code,L.EXTRA,index));
    const offered=card(opening.code,L.HAND);
    const prompt={...idle(),summons:opening.action===A.SELECT_SUMMON?[offered]:[],
      activates:opening.action===A.SELECT_ACTIVATE?[offered]:[]};
    const move=decisionMoves(guide.decisions,board,0,ownDeck,prompt).find((entry)=>entry.decision.id===opening.decision);
    assert.equal(move?.action,opening.action,`${opening.id}: ação do guia oferecida pelo motor`);
    assert.equal(move?.targetCode,opening.target,`${opening.id}: alvo da continuação`);
    const brain=new BotBrain({difficulty:'hard',deck:ownDeck,format:'tcg'});
    const response=brain.decide(ctx(prompt,board));
    assert.equal(response.action,opening.action,`${opening.id}: Difícil inicia a abertura`);
    assert.equal(brain.lastTrace.guideDecision,opening.decision,`${opening.id}: decisão rastreável`);
    assert.deepEqual(brain.decide(ctx(select([card(99999999,L.DECK),card(opening.target,L.DECK)]),board)).indicies,[1],
      `${opening.id}: seleção usa o alvo do guia quando o motor o oferece`);
    assert.equal(decisionMoves(guide.decisions,board,0,ownDeck,idle()).length,0,
      `${opening.id}: decisão não cria ação ausente no motor`);
    assert.equal(guideHintsForDeck({...ownDeck,main:ownDeck.main.slice(1)},'tcg'),null,
      `${opening.id}: guia não se aplica a outra lista`);
  }
  console.log(`✓ ${openings.length} novos decks usam decisões com condição, ação legal e alvo`);
}
{
  const cases=[
    {id:'tcg-sr06',decision:'ahrima-busca-covil',hand:[86377375],target:59160188,avoid:[59160188],result:59160188},
    {id:'tcg-sdbt',decision:'myrmeleo-encontra-holeutea',hand:[91812341],target:74577599,avoid:[74577599],result:73639099},
    {id:'tcg-sr14',decision:'ponix-encontra-santuario',hand:[90681088],target:65305978,avoid:[65305978],result:57554544},
    {id:'tcg-sdcs',decision:'claw-encontra-realm',hand:[82562802],target:64753988,avoid:[64753988],result:64753988},
    {id:'tcg-l26d-x-saber',decision:'boggart-abre-faultroll',hand:[5998840,31383545,51808422],target:31383545,result:51808422},
    {id:'tcg-sr04',decision:'oviraptor-encontra-tyranno',hand:[44335251],grave:[36042004,82946847],target:18940556,avoid:[18940556],result:18940556},
    {id:'tcg-sdrr',decision:'quick-launch-encontra-tracer',hand:[31443476],target:68464358,avoid:[68464358],result:68464358},
  ];
  const foe=getPresetDeck('tcg-sdy');
  for(const testCase of cases){
    const guided=getPresetDeck(testCase.id),session=createDuelSession(),trace=[];
    const excluded=new Set([...testCase.hand,...(testCase.grave??[]),...(testCase.avoid??[])]);
    const hand=[...testCase.hand,...guided.main.filter(code=>!excluded.has(code)).slice(0,5-testCase.hand.length)];
    try{
      await session.start({playerName:'Bot',playerDeck:guided,opponentName:'Parceiro',opponentDeck:foe,
        registry,assets:nodeAssets,format:'tcg',pace:0,cutIns:false,watchSeat:0,testSeed:73,
        openingHands:[hand,foe.main.slice(0,5)],
        scenario:(testCase.grave??[]).map(code=>({player:0,location:L.GRAVE,code})),
        seats:[{kind:'bot',name:'Bot',bot:{difficulty:'hard',onDecision(t){trace.push(t);}}},{kind:'local',name:'Parceiro'}]});
      assert.equal(session.getSnapshot().error,null,`${testCase.id}: sem erro no motor`);
      assert.ok(trace.some(t=>t.guideDecision===testCase.decision),`${testCase.id}: executa a decisão em duelo real`);
      const selected=trace.some(t=>t.prompt===M.SELECT_CARD && t.observation.prompt.selects
        .some(candidate=>candidate.code===testCase.target) && t.response.indicies
        .some(index=>t.observation.prompt.selects[index]?.code===testCase.target));
      const mine=readBoardState(session.core,session.handle,0).players[0];
      const resolved=[...(testCase.hand.includes(testCase.target)?[]:mine.hand),...mine.monsters,...mine.spells,...mine.grave,...mine.banished]
        .some(placed=>placed?.code===testCase.target) || mine.field?.code===testCase.target;
      assert.ok(selected||resolved,`${testCase.id}: alvo buscado, invocado ou escolhido`);
      assert.ok([...mine.monsters,...mine.spells,...mine.grave].some(placed=>placed?.code===testCase.result)
        || mine.field?.code===testCase.result,`${testCase.id}: completa a continuação ensinada`);
    }finally{session.dispose();}
  }
  console.log(`✓ ${cases.length} novos decks executam a abertura guiada no motor real`);
}
{
  const ownDeck=getPresetDeck('tcg-sdaz');
  const guide=guideHintsForDeck(ownDeck,'tcg');
  const board={players:[empty(),empty()]};
  board.players[0].hand=[card(44362883,L.HAND)];
  board.players[0].extra=[card(87746184,L.EXTRA),card(44146295,L.EXTRA)];
  const albion=guide.decisions.find(d=>d.id==='albion-sem-descarte');
  const p=idle([card(44362883,L.HAND)]);
  assert.equal(decisionApplies(albion,board,0,ownDeck),true,'sem descarte, a rota Albion está disponível');
  assert.equal(decisionMoves(guide.decisions,board,0,ownDeck,p)[0]?.targetCode,87746184);
  const brain=new BotBrain({difficulty:'hard',deck:ownDeck,format:'tcg',seed:11});
  const first=brain.decide(ctx(p,board));
  assert.equal(first.action,A.SELECT_ACTIVATE);
  assert.match(brain.lastTrace.reason,/Cenário do guia/);
  const fusion=brain.decide(ctx(select([card(70534340,L.EXTRA),card(87746184,L.EXTRA)]),board));
  assert.deepEqual(fusion.indicies,[1],'o bot escolhe Albion, não a primeira Fusão oferecida');
  board.players[0].hand=[card(44362883,L.HAND),card(10813327,L.HAND)];
  assert.equal(decisionApplies(albion,board,0,ownDeck),false,'com descarte disponível, a regra específica não força Albion');
  const hiddenA={players:[board.players[0],{...empty(),hand:[card(89631139,L.HAND,0,1)]}]};
  const hiddenB={players:[board.players[0],{...empty(),hand:[card(91152256,L.HAND,0,1)]}]};
  assert.deepEqual(decisionMoves(guide.decisions,hiddenA,0,ownDeck,p),decisionMoves(guide.decisions,hiddenB,0,ownDeck,p),'a mão oculta adversária não altera o cenário');
  const kitt=guide.decisions.find(d=>d.id==='kitt-encontra-a-fusao');
  board.players[0].hand=[card(45484331,L.HAND),card(10813327,L.HAND)];
  assert.equal(decisionApplies(kitt,board,0,ownDeck),true);
  assert.equal(decisionMoves(guide.decisions,board,0,ownDeck,{...idle(),summons:[]}).length,0,'o guia não inventa ação que o motor não oferece');
  const albazNoMatch={...ownDeck,main:ownDeck.main.slice(1)};
  assert.equal(guideHintsForDeck(albazNoMatch,'tcg'),null,'a regra não vaza para lista alterada');
  const aesir=getPresetDeck('tcg-lehd-aesir');
  const knights=getPresetDeck('tcg-lehd-phantom-knights');
  const knightsGuide=guideHintsForDeck(knights,'tcg');
  const knightsProfile=await loadBotProfile(knights,'tcg');
  assert.ok(knightsProfile);
  const unfinishedKnights={players:[empty(),empty()]};
  unfinishedKnights.players[0].monsters[0]=card(62709239,L.MZONE);
  unfinishedKnights.players[0].hand=[card(90432163,L.HAND),card(36426778,L.HAND,1)];
  unfinishedKnights.players[0].extra=[card(62709239,L.EXTRA)];
  const knightPlanner=new BotPlanner(knightsProfile,knights);
  knightPlanner.observe(ctx({...idle(),summons:[card(90432163,L.HAND)]},unfinishedKnights),BOT_POLICIES.hard,performance.now()+40);
  assert.equal(knightPlanner.route?.id,'primeiro-xyz','Espada Quebrada é uma ponte, não o fim automático do turno');
  const midKnights={players:[empty(),empty()]};
  midKnights.players[0].monsters[0]=card(90432163,L.MZONE);
  midKnights.players[0].hand=[card(36426778,L.HAND)];
  midKnights.players[0].extra=[card(62709239,L.EXTRA)];
  const resumeKnights=new BotPlanner(knightsProfile,knights);
  resumeKnights.observe(ctx({...idle(),special_summons:[card(36426778,L.HAND)]},midKnights),BOT_POLICIES.hard,performance.now()+40);
  assert.equal(resumeKnights.route?.id,'primeiro-xyz');
  assert.equal(resumeKnights.stepIndex,1,'o campo confirma Manto e permite retomar da Invocação de Botas');
  const resumedKnightsBrain=new BotBrain({difficulty:'hard',deck:knights,format:'tcg',profile:knightsProfile});
  assert.equal(resumedKnightsBrain.decide(ctx({...idle(),special_summons:[card(36426778,L.HAND)]},midKnights)).action,A.SELECT_SPECIAL_SUMMON);
  assert.equal(resumedKnightsBrain.lastTrace.route,'primeiro-xyz','a resposta final executa a etapa retomada');
  const knightsBoard={players:[empty(),empty()]};
  knightsBoard.players[0].hand=[card(99315585,L.HAND),card(90432163,L.HAND,1),card(19353570,L.HAND,2)];
  knightsBoard.players[0].extra=[card(62709239,L.EXTRA)];
  const knightsPrompt={...idle(),summons:[card(99315585,L.HAND),card(90432163,L.HAND,1)]};
  const knightsBrain=new BotBrain({difficulty:'hard',deck:knights,format:'tcg'});
  assert.equal(knightsBrain.decide(ctx(knightsPrompt,knightsBoard)).index,1,
    'sem Botas, Difícil usa Manto para abrir Kagemucha e Espada Quebrada');
  assert.equal(knightsBrain.lastTrace.guideDecision,'kagemucha-sem-botas');
  const reinforcements={players:[empty(),empty()]};
  reinforcements.players[0].hand=[card(32807846,L.HAND),card(90432163,L.HAND,1),card(19353570,L.HAND,2)];
  reinforcements.players[0].extra=[card(62709239,L.EXTRA)];
  const reinforcementsBrain=new BotBrain({difficulty:'hard',deck:knights,format:'tcg'});
  assert.equal(reinforcementsBrain.decide(ctx(idle([card(32807846,L.HAND)]),reinforcements)).action,A.SELECT_ACTIVATE);
  assert.equal(reinforcementsBrain.lastTrace.guideDecision,'reforcos-encontram-botas-para-manto');
  assert.deepEqual(reinforcementsBrain.decide(ctx(select([card(99315585,L.DECK),card(36426778,L.DECK)]),reinforcements)).indicies,[1],
    'Reforço encontra Botas em vez do Guerreiro com mais ATK');
  const bootsReinforcements={players:[empty(),empty()]};
  bootsReinforcements.players[0].hand=[card(32807846,L.HAND),card(36426778,L.HAND,1)];
  bootsReinforcements.players[0].extra=[card(62709239,L.EXTRA)];
  const bootsSearch=new BotBrain({difficulty:'hard',deck:knights,format:'tcg'});
  assert.equal(bootsSearch.decide(ctx(idle([card(32807846,L.HAND)]),bootsReinforcements)).action,A.SELECT_ACTIVATE);
  assert.equal(bootsSearch.lastTrace.guideDecision,'reforcos-encontram-manto-para-botas');
  assert.deepEqual(bootsSearch.decide(ctx(select([card(99315585,L.DECK),card(90432163,L.DECK)]),bootsReinforcements)).indicies,[1]);
  const junkSequence={players:[empty(),empty()]};
  junkSequence.players[0].hand=[card(56410040,L.HAND),card(36426778,L.HAND,1)];
  junkSequence.players[0].extra=[card(62709239,L.EXTRA)];
  assert.equal(sequenceFollowUp(knightsGuide.decisions,junkSequence,0,knights,A.SELECT_SPECIAL_SUMMON,card(56410040,L.HAND))?.id,
    'junk-forward-com-botas','a Invocação-Especial libera Botas como próximo passo');
  const junkBoard={players:[empty(),empty()]};
  junkBoard.players[0].monsters[0]=card(56410040,L.MZONE);
  junkBoard.players[0].hand=[card(99315585,L.HAND),card(36426778,L.HAND,1)];
  junkBoard.players[0].extra=[card(62709239,L.EXTRA)];
  const junkBot=new BotBrain({difficulty:'hard',deck:knights,format:'tcg'});
  assert.equal(junkBot.decide(ctx({...idle(),summons:[card(99315585,L.HAND),card(36426778,L.HAND,1)]},junkBoard)).index,1,
    'com Junk Forward no campo, Botas vira a segunda matéria de Espada Quebrada');
  assert.equal(junkBot.lastTrace.guideDecision,'junk-forward-com-botas');
  const breakSwordBoard={players:[empty(),empty()]};
  breakSwordBoard.players[0].monsters[0]={...card(62709239,L.MZONE),overlays:[56410040,36426778]};
  breakSwordBoard.players[1].monsters[0]=card(63821877,L.MZONE,0,1);
  const breakSwordPrompt=idle([card(62709239,L.MZONE)]);
  assert.equal(new BotBrain({difficulty:'hard',deck:knights,format:'tcg',phantomStrategy:false}).decide(ctx(breakSwordPrompt,breakSwordBoard)).action,A.TO_EP,
    'Espada Quebrada sem duas matérias Cavaleiro não se autodestrói por monstro pequeno');
  breakSwordBoard.players[0].monsters[0].overlays=[90432163,36426778];
  assert.equal(new BotBrain({difficulty:'hard',deck:knights,format:'tcg',phantomStrategy:false}).decide(ctx(breakSwordPrompt,breakSwordBoard)).action,A.SELECT_ACTIVATE,
    'Espada Quebrada pode trocar quando os materiais permitem reviver dois Cavaleiros');
  knightsBoard.players[0].hand.push(card(36426778,L.HAND,3));
  assert.equal(decisionApplies(knightsGuide.decisions.find(d=>d.id==='kagemucha-sem-botas'),knightsBoard,0,knights),false,
    'com Botas na mão, a regra alternativa deixa o perfil escolher a rota completa');
  const destiny=getPresetDeck('tcg-lehd-destiny-hero'),destinyGuide=guideHintsForDeck(destiny,'tcg');
  const destinyProfile=await loadBotProfile(destiny,'tcg');
  assert.ok(destinyProfile);
  const unfinishedHero={players:[empty(),empty()]};
  unfinishedHero.players[0].monsters[0]=card(9411399,L.MZONE);
  unfinishedHero.players[0].hand=[card(50720316,L.HAND),card(21143940,L.HAND,1)];
  unfinishedHero.players[0].extra=[card(58481572,L.EXTRA)];
  const heroPlanner=new BotPlanner(destinyProfile,destiny);
  heroPlanner.observe(ctx({...idle(),summons:[card(50720316,L.HAND)]},unfinishedHero),BOT_POLICIES.hard,performance.now()+40);
  assert.equal(heroPlanner.route?.id,'dark-law','Malicioso em campo é extensão, não resultado pronto');
  const midHero={players:[empty(),empty()]};
  midHero.players[0].monsters[0]=card(50720316,L.MZONE);
  midHero.players[0].hand=[card(21143940,L.HAND)];
  midHero.players[0].extra=[card(58481572,L.EXTRA)];
  const resumeHero=new BotPlanner(destinyProfile,destiny);
  resumeHero.observe(ctx(idle([card(21143940,L.HAND)]),midHero),BOT_POLICIES.hard,performance.now()+40);
  assert.equal(resumeHero.route?.id,'dark-law');
  assert.equal(resumeHero.stepIndex,1,'Névoa Sombria em campo permite entrar diretamente em Mudar a Máscara');
  const resumedHeroBrain=new BotBrain({difficulty:'hard',deck:destiny,format:'tcg',profile:destinyProfile});
  assert.equal(resumedHeroBrain.decide(ctx(idle([card(21143940,L.HAND)]),midHero)).action,A.SELECT_ACTIVATE);
  assert.equal(resumedHeroBrain.lastTrace.route,'dark-law','a resposta final retoma a etapa da máscara');
  const noResume=new BotPlanner(destinyProfile,destiny);
  noResume.observe(ctx(idle([card(21143940,L.HAND)]),midHero),BOT_POLICIES.medium,performance.now()+40);
  assert.equal(noResume.route,null,'a retomada de rota é análise adicional do Difícil');
  const destinyBoard={players:[empty(),empty()]};
  destinyBoard.players[0].monsters[0]=card(91691605,L.MZONE);
  destinyBoard.players[0].hand=[card(26964762,L.HAND),card(9411399,L.HAND,1)];
  const drillTargets=[card(26964762,L.HAND),card(9411399,L.HAND,1)];
  assert.equal(decisionEffectTarget(destinyGuide.decisions,destinyBoard,0,destiny,91691605,drillTargets)?.index,1);
  const destinyBrain=new BotBrain({difficulty:'hard',deck:destiny,format:'tcg'});
  assert.deepEqual(destinyBrain.decide({...ctx(select(drillTargets),destinyBoard),
    resolvingEffect:{code:91691605,player:0,description:0n}}).indicies,[1],
    'Broca-negra escolhe Malicioso mesmo quando Anjo Negro vem primeiro');
  assert.equal(destinyBrain.lastTrace.guideDecision,'broca-negra-estende-com-malicioso');
  const sequenceBoard={players:[empty(),empty()]};
  sequenceBoard.players[0].hand=[card(91691605,L.HAND),card(9411399,L.HAND,1),card(13093792,L.HAND,2)];
  assert.equal(decisionApplies(destinyGuide.decisions.find(d=>d.id==='broca-negra-estende-com-malicioso'),sequenceBoard,0,destiny),false);
  assert.equal(sequenceFollowUp(destinyGuide.decisions,sequenceBoard,0,destiny,A.SELECT_SUMMON,card(91691605,L.HAND))?.id,
    'broca-negra-estende-com-malicioso','a Invocação projeta o próximo alvo do guia');
  const unseenA={players:[sequenceBoard.players[0],{...empty(),hand:[card(89631139,L.HAND,0,1)]}]};
  const unseenB={players:[sequenceBoard.players[0],{...empty(),hand:[card(91152256,L.HAND,0,1)]}]};
  assert.equal(sequenceFollowUp(destinyGuide.decisions,unseenA,0,destiny,A.SELECT_SUMMON,card(91691605,L.HAND))?.id,
    sequenceFollowUp(destinyGuide.decisions,unseenB,0,destiny,A.SELECT_SUMMON,card(91691605,L.HAND))?.id,
    'a projeção não usa a identidade da mão adversária');
  const noTarget={players:[{...sequenceBoard.players[0],hand:[card(91691605,L.HAND),card(13093792,L.HAND,1)]},empty()]};
  assert.equal(sequenceFollowUp(destinyGuide.decisions,noTarget,0,destiny,A.SELECT_SUMMON,card(91691605,L.HAND)),null,
    'sem a peça seguinte, o planejador não inventa uma sequência');
  const sequenceBrain=new BotBrain({difficulty:'hard',deck:destiny,format:'tcg'});
  const sequenceOpening=sequenceBrain.decide(ctx({...idle(),summons:[card(13093792,L.HAND,2),card(91691605,L.HAND)]},sequenceBoard));
  assert.equal(sequenceOpening.action,A.SELECT_SUMMON);
  assert.equal(sequenceOpening.index,1,'Difícil prefere a sequência Broca-negra + Malicioso a Homem Diamante isolado');
  assert.match(sequenceBrain.lastTrace.reason,/Sequência prevista pelo guia/);
  assert.equal(new BotBrain({difficulty:'hard',deck:destiny,format:'tcg',sequencePlanning:false,heroStrategy:false})
    .decide(ctx({...idle(),summons:[card(13093792,L.HAND,2),card(91691605,L.HAND)]},sequenceBoard)).index,0,
    'o mesmo estado sem projeção escolheria apenas pelo valor imediato');
  destinyBoard.players[0].hand=[card(26964762,L.HAND)];
  assert.equal(decisionEffectTarget(destinyGuide.decisions,destinyBoard,0,destiny,91691605,drillTargets),null,
    'o guia não presume Malicioso na mão');
  const deciderBoard={players:[empty(),empty()]};
  deciderBoard.players[0].hand=[card(64184058,L.HAND),card(91691605,L.HAND,1)];
  const deciderBrain=new BotBrain({difficulty:'hard',deck:destiny,format:'tcg'});
  assert.equal(deciderBrain.decide(ctx({...idle(),summons:[card(64184058,L.HAND),card(91691605,L.HAND,1)]},deciderBoard)).index,1,
    'com Decisor na mão, Broca-negra recebe a Invocação-Normal');
  assert.equal(deciderBrain.lastTrace.guideDecision,'broca-negra-com-decisor');
  assert.deepEqual(deciderBrain.decide({...ctx(select([card(26964762,L.HAND),card(64184058,L.HAND,1)]),deciderBoard),
    resolvingEffect:{code:91691605,player:0,description:0n}}).indicies,[1],
    'a continuação da decisão invoca Decisor');
  const celestialBoard={players:[empty(),empty()]};
  celestialBoard.players[0].hand=[card(63362460,L.HAND),card(91691605,L.HAND,1)];
  const celestialBrain=new BotBrain({difficulty:'hard',deck:destiny,format:'tcg'});
  assert.equal(celestialBrain.decide(ctx({...idle(),summons:[card(63362460,L.HAND),card(91691605,L.HAND,1)]},celestialBoard)).index,1);
  assert.equal(celestialBrain.lastTrace.guideDecision,'broca-negra-com-celestial');
  const plasmaBoard={players:[empty(),empty()]};
  plasmaBoard.players[0].monsters[0]=card(91691605,L.MZONE);
  plasmaBoard.players[0].monsters[1]=card(91691605,L.MZONE,1);
  plasmaBoard.players[0].monsters[2]=card(64184058,L.MZONE,2);
  const plasmaPrompt={...idle(),special_summons:[card(83965310,L.HAND)]};
  assert.equal(new BotBrain({difficulty:'hard',deck:destiny,format:'tcg'}).decide(ctx(plasmaPrompt,plasmaBoard)).action,A.TO_EP,
    'Difícil preserva três HERÓIS fortes quando Plasma não tem alvo nem efeitos a negar');
  const dogmaBoard={players:[empty(),empty()]};
  dogmaBoard.players[0].monsters=[card(91691605,L.MZONE),card(59642500,L.MZONE,1),card(58481572,L.MZONE,2),null,null,null,null];
  const dogmaPrompt={...idle(),special_summons:[card(17132130,L.HAND)]};
  assert.equal(new BotBrain({difficulty:'hard',deck:destiny,format:'tcg'}).decide(ctx(dogmaPrompt,dogmaBoard)).action,A.TO_EP,
    'Dogma não consome três HERÓIS que já pressionam e controlam o campo');
  dogmaBoard.players[0].monsters=[card(99357565,L.MZONE),card(99357565,L.MZONE,1),card(99357565,L.MZONE,2),null,null,null,null];
  assert.equal(new BotBrain({difficulty:'hard',deck:destiny,format:'tcg'}).decide(ctx(dogmaPrompt,dogmaBoard)).action,A.SELECT_SPECIAL_SUMMON,
    'Dogma pode converter três materiais baratos em um atacante de 3400');
  plasmaBoard.players[0].monsters=[card(99357565,L.MZONE),card(99357565,L.MZONE,1),card(99357565,L.MZONE,2),null,null,null,null];
  assert.equal(new BotBrain({difficulty:'hard',deck:destiny,format:'tcg'}).decide(ctx(plasmaPrompt,plasmaBoard)).action,A.SELECT_SPECIAL_SUMMON,
    'três D ao Cubo de baixo valor continuam bons Tributos para Plasma');
  const maskBoard={players:[empty(),empty()]};
  maskBoard.players[0].monsters[0]=card(91691605,L.MZONE);
  maskBoard.players[0].hand=[card(21143940,L.HAND)];
  maskBoard.players[0].extra=[card(59642500,L.EXTRA),card(58481572,L.EXTRA,1)];
  const maskBrain=new BotBrain({difficulty:'hard',deck:destiny,format:'tcg'});
  assert.equal(maskBrain.decide(ctx(idle([card(21143940,L.HAND)]),maskBoard)).action,A.SELECT_ACTIVATE);
  assert.equal(maskBrain.lastTrace.guideDecision,'broca-negra-vira-lei-obscura');
  assert.deepEqual(maskBrain.decide(ctx(select([card(91691605,L.MZONE)]),maskBoard)).indicies,[0]);
  assert.deepEqual(maskBrain.decide(ctx(select([card(59642500,L.EXTRA),card(58481572,L.EXTRA,1)]),maskBoard)).indicies,[1],
    'Mudar a Máscara escolhe Lei Obscura em vez de Anki pelo ATK');
  maskBoard.players[0].monsters[1]=card(26964762,L.MZONE,1);
  assert.equal(decisionApplies(destinyGuide.decisions.find(d=>d.id==='broca-negra-vira-lei-obscura'),maskBoard,0,destiny),false,
    'o guia não força Mudar a Máscara sob a negação de Anjo Negro');
  assert.equal(new BotBrain({difficulty:'hard',deck:destiny,format:'tcg'}).decide(ctx(idle([card(21143940,L.HAND)]),maskBoard)).action,A.TO_EP,
    'Difícil não gasta Magia que Anjo Negro anularia');
  const angelBoard={players:[empty(),empty()]};
  angelBoard.players[0].hand=[card(26964762,L.HAND),card(21143940,L.HAND,1)];
  const angelBrain=new BotBrain({difficulty:'hard',deck:destiny,format:'tcg'});
  assert.equal(angelBrain.decide(ctx({...idle(),summons:[card(26964762,L.HAND)],monster_sets:[card(26964762,L.HAND)]},angelBoard)).action,A.TO_EP,
    'Difícil não abre Normal ou Baixando Anjo Negro no próprio campo');
  assert.equal(angelBrain.decide(ctx({type:M.SELECT_EFFECTYN,player:0,code:91691605,controller:0,description:0n},angelBoard)).yes,false,
    'Broca-negra não coloca Anjo Negro no próprio campo para anular Mudar a Máscara');
  angelBoard.players[0].hand.unshift(card(56570271,L.HAND,2));
  const alternativeBrain=new BotBrain({difficulty:'hard',deck:destiny,format:'tcg'});
  assert.equal(alternativeBrain.decide(ctx({type:M.SELECT_EFFECTYN,player:0,code:91691605,controller:0,description:0n},angelBoard)).yes,true,
    'Broca-negra ainda usa o efeito quando existe outro HERÓI elegível');
  assert.deepEqual(alternativeBrain.decide({...ctx(select([card(26964762,L.HAND),card(56570271,L.HAND,2)]),angelBoard),
    resolvingEffect:{code:91691605,player:0,description:0n}}).indicies,[1],
    'o alvo alternativo preserva as Magias em vez de trazer Anjo Negro');
  const blazemanBoard={players:[empty(),empty()]};
  blazemanBoard.players[0].hand=[card(63060238,L.HAND),card(13093792,L.HAND,1)];
  const blazemanPrompt={...idle(),summons:[card(63060238,L.HAND),card(13093792,L.HAND,1)],
    monster_sets:[card(63060238,L.HAND),card(13093792,L.HAND,1)]};
  const blazemanChoice=new BotBrain({difficulty:'hard',deck:destiny,format:'tcg'}).decide(ctx(blazemanPrompt,blazemanBoard));
  assert.equal(blazemanChoice.action,A.SELECT_SUMMON,'Homem em Chamas usa o efeito em vez de ficar Baixado');
  assert.equal(blazemanChoice.index,0);
  const aesirGuide=guideHintsForDeck(aesir,'tcg');
  assert.equal(aesirGuide.decisions.find(d=>d.id==='valquiria-antes-da-magia').botEligible,false,'cenário com pré-requisito ainda não codificado fica editorial');
  const world=getPresetDeck('tcg-sr13'),worldGuide=guideHintsForDeck(world,'tcg');
  const worldBoard={players:[empty(),empty()]};
  worldBoard.players[0].hand=[card(77895328,L.HAND)];
  assert.equal(decisionApplies(worldGuide.decisions.find(d=>d.id==='genta-encontra-gates'),worldBoard,0,world),true,'Genta busca Gates sem exigir Snoww na mão');
  const striker=getPresetDeck('tcg-l26d-sky-striker'),strikerGuide=guideHintsForDeck(striker,'tcg');
  const strikerBoard={players:[empty(),empty()]};
  const opener={players:[empty(),empty()]};
  opener.players[0].hand=[card(37351133,L.HAND),card(26077387,L.HAND,1)];
  opener.players[0].extra=[card(63288573,L.EXTRA)];
  const firstNormal={...idle(),summons:[card(37351133,L.HAND),card(26077387,L.HAND,1)]};
  const opened=new BotBrain({difficulty:'hard',deck:striker,format:'tcg'});
  assert.equal(opened.decide(ctx(firstNormal,opener)).index,1,'com Raye e Roze, Difícil abre pela Raye');
  assert.equal(opened.lastTrace.guideDecision,'raye-abre-o-link');
  const rozeField={players:[empty(),empty()]};
  rozeField.players[0].monsters[0]=card(26077387,L.MZONE);
  rozeField.players[0].extra=[card(63288573,L.EXTRA)];
  const rozeEffect={type:M.SELECT_EFFECTYN,player:0,code:37351133,controller:0,description:0n};
  assert.equal(new BotBrain({difficulty:'hard',deck:striker,format:'tcg'}).decide(ctx(rozeEffect,rozeField)).yes,false,
    'Roze opcional não bloqueia a zona principal enquanto Raye pode fazer Link');
  strikerBoard.players[0].monsters[0]=card(26077387,L.MZONE);
  strikerBoard.players[0].grave=[card(63166095,L.GRAVE)];
  strikerBoard.players[0].extra=[card(63288573,L.EXTRA)];
  const strikerBrain=new BotBrain({difficulty:'hard',deck:striker,format:'tcg'});
  const linkPrompt={...idle(),special_summons:[card(63288573,L.EXTRA)]};
  const link=strikerBrain.decide(ctx(linkPrompt,strikerBoard));
  assert.equal(link.action,A.SELECT_SPECIAL_SUMMON);
  assert.equal(strikerBrain.lastTrace.guideDecision,'kagari-recupera-engage');
  const recovered=strikerBrain.decide(ctx(select([card(50005218,L.GRAVE),card(63166095,L.GRAVE)]),strikerBoard));
  assert.deepEqual(recovered.indicies,[1],'Kagari recupera Engage, mesmo que não seja o primeiro alvo');
  strikerBoard.players[0].monsters[5]=card(8491308,L.MZONE,5);
  assert.equal(decisionApplies(strikerGuide.decisions.find(d=>d.id==='kagari-recupera-engage'),strikerBoard,0,striker),false,
    'regra de Kagari não empilha Links quando um já ocupa o campo');
  const linkOnly={players:[empty(),empty()]};
  linkOnly.players[0].monsters[5]=card(63288573,L.MZONE,5);
  const linkLoop={...idle(),special_summons:[card(90673288,L.EXTRA)]};
  const noLoop=new BotBrain({difficulty:'hard',deck:striker,format:'tcg'}).decide(ctx(linkLoop,linkOnly));
  assert.equal(noLoop.action,A.TO_EP,'não troca um Link-1 por outro apenas pelo bônus editorial');
  console.log('✓ decisões do Aprender usam condição visível, ação legal e alvo da rota');
}
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
  const board={players:[empty(),empty()]};
  board.players[0].monsters[0]=card(89631139,L.MZONE,0,0);
  board.players[0].monsters[1]=card(5053103,L.MZONE,1,0);
  board.players[1].monsters[0]=card(89631139,L.MZONE,0,1);
  const raigeki=new BotBrain({difficulty:'hard'}).decide(ctx(idle([card(12580477)]),board));
  assert.equal(raigeki.action,A.SELECT_ACTIVATE,'Raigeki limpa apenas os monstros adversários');
  board.players[1].monsters[0]=null;
  board.players[0].spells[0]=card(5318639,L.SZONE,0,0);
  board.players[0].spells[1]=card(5318639,L.SZONE,1,0);
  board.players[1].spells[0]=card(5318639,L.SZONE,0,1);
  const duster=new BotBrain({difficulty:'hard'}).decide(ctx(idle([card(18144506)]),board));
  const storm=new BotBrain({difficulty:'hard'}).decide(ctx(idle([card(19613556)]),board));
  assert.equal(duster.action,A.SELECT_ACTIVATE,'Espanador limpa a única carta adversária sem perder as próprias');
  assert.equal(storm.action,A.TO_EP,'Tempestade Pesada preserva as próprias cartas quando a troca é ruim');
  const optional=new BotBrain({difficulty:'hard'}).decide(ctx(select([card(5053103)],0,1)));
  assert.deepEqual(optional.indicies,[],'seleção opcional não entrega uma carta própria sem benefício');
  assert.ok(BOT_POLICIES.hard.cpuMs>BOT_POLICIES.medium.cpuMs,'Difícil recebe mais tempo de planejamento');
  console.log('✓ remoção assimétrica, seleção opcional e orçamento do Difícil');
}
{
  const route={id:'defesa',lesson:'defesa',objective:'Reforçar o campo',requires:[],minHand:0,reserves:[],
    steps:[{id:'invocar',effects:[],action:{kind:'summons',code:89631139},targets:[],completeWhen:[{kind:'card',zone:'monsters',code:89631139}]}],
    result:{pressure:2800,interaction:1,continuation:0,cost:0,exposure:0}};
  const strategy={roles:[{code:5053103,roles:['finisher']}],routes:[route]};
  const prompt={...idle(),summons:[card(89631139)]};
  const safe={players:[empty(),empty()]};
  safe.players[0].monsters[0]=card(5053103,L.MZONE,0,0);
  const cautious=new BotPlanner(strategy,{main:[],extra:[],side:[]});
  cautious.observe(ctx(prompt,safe),BOT_POLICIES.hard,performance.now()+100);
  assert.equal(cautious.route,null,'mesa estabelecida preserva recursos sem ameaça');
  const threatened=structuredClone(safe);
  threatened.players[1].monsters[0]={...card(89631139,L.MZONE,0,1),attack:3000};
  const adaptive=new BotPlanner(strategy,{main:[],extra:[],side:[]});
  adaptive.observe(ctx(prompt,threatened),BOT_POLICIES.hard,performance.now()+100);
  assert.equal(adaptive.route?.id,'defesa','ameaça visível permite planejar reforço');
  console.log('✓ plano de deck reconsiderado conforme a ameaça visível');
}
{
  const costStep={id:'tres-cartas',effects:[90207654],spend:'banish',
    targets:[42793609,89792713,86827882].map(code=>({code,location:L.HAND})),
    completeWhen:[42793609,89792713,86827882].map(code=>({kind:'card',zone:'banished',code}))};
  const after={id:'continuar',effects:[],targets:[],completeWhen:[{kind:'card',zone:'monsters',code:93483212}]};
  const route={id:'teste-custo',lesson:'teste',objective:'Continuar após custo alternativo',requires:[],minHand:0,reserves:[],steps:[costStep,after],
    result:{pressure:3000,interaction:1,continuation:1,cost:3,exposure:0}};
  const planner=new BotPlanner({roles:[],routes:[route]},{main:[],extra:[],side:[]});
  const board={players:[empty(),empty()]};
  const alternatives=[card(53129443,L.HAND),card(55154048,L.HAND,1),card(77060848,L.HAND,2)];
  board.players[0].hand=alternatives;
  planner.turn=1;planner.route=route;
  for(let count=1;count<=3;count++){
    const prompt={type:M.SELECT_UNSELECT_CARD,player:0,can_finish:true,can_cancel:false,min:1,max:3,
      select_cards:[card(53129443,L.HAND)],unselect_cards:alternatives.slice(0,count)};
    const response=profileResponse({...ctx(prompt,board),resolvingEffect:{code:90207654,player:0,description:0n}},planner,BOT_POLICIES.hard);
    assert.equal(response.index===null,count===3,`Gullveig só termina após três custos: ${count}/3`);
  }
  planner.recordSpend(alternatives,{...ctx(idle(),board),resolvingEffect:{code:90207654,player:0,description:0n}});
  board.players[0].banished=alternatives.map((item,index)=>card(item.code,L.REMOVED,index));
  planner.observe(ctx(idle(),board),BOT_POLICIES.hard,performance.now()+100);
  assert.equal(planner.stepIndex,1,'três custos alternativos confirmados mantêm a rota na etapa seguinte');
  assert.equal(planner.route?.id,'teste-custo','etapa de efeito sem ação de Main Phase não é abandonada');
  console.log('✓ perfil continua após três custos alternativos e uma etapa de efeito');
}
{
  const guided=getPresetDeck('tcg-5ds1');
  const hints=guideHintsForDeck(guided,'tcg');
  assert.ok(hints?.opening.includes(63977008),'índice extrai Junk Synchron da primeira jogada do guia');
  assert.equal(guideHintsForDeck({...guided,main:guided.main.slice(1)},'tcg'),null,'lista alterada não recebe instruções do preset');
  const hard=new BotBrain({difficulty:'hard',deck:guided,format:'tcg'});
  const medium=new BotBrain({difficulty:'medium',deck:guided,format:'tcg'});
  assert.equal(hard.planner.guide?.id,'tcg-5ds1');
  assert.equal(medium.planner.guide,null,'prioridade editorial só no Difícil');
  const search=select([card(63977008,L.DECK),card(89631139,L.DECK,1)]);
  assert.deepEqual(hard.decide(ctx(search)).indicies,[0],'Difícil busca a peça inicial do próprio guia');
  assert.deepEqual(medium.decide(ctx(search)).indicies,[1],'Médio mantém avaliação genérica');
  const spend=select([card(63977008,L.HAND),card(5053103,L.HAND,1)]);
  assert.deepEqual(hard.decide(ctx(spend)).indicies,[1],'Difícil preserva a peça central ao descartar');
  const summon={...idle(),summons:[card(63977008),card(5053103,L.HAND,1)]};
  const ready={players:[empty(),empty()]};
  ready.players[0].hand=[card(63977008),card(5053103,L.HAND,1)];
  ready.players[0].grave=[card(9365703,L.GRAVE)];
  assert.equal(new BotBrain({difficulty:'hard',deck:guided,format:'tcg'}).decide(ctx(summon,ready)).index,0,
    'Difícil inicia a sequência do guia quando o material está no Cemitério');
  assert.equal(new BotBrain({difficulty:'medium',deck:guided,format:'tcg'}).decide(ctx(summon,ready)).index,1,
    'Médio ainda prefere o monstro de maior ATK');
  ready.players[0].grave=[];
  assert.equal(new BotBrain({difficulty:'hard',deck:guided,format:'tcg'}).decide(ctx(summon,ready)).index,1,
    'sem material visível o Difícil abandona essa abertura');
  console.log('✓ guia influencia busca e custos sem revelar o deck adversário');
}
{
  const board={players:[empty(),empty()]};
  board.players[0].monsters[0]=card(5053103,L.MZONE,0,0);
  board.players[0].monsters[2]=card(5053103,L.MZONE,2,0);
  const prompt={type:M.SELECT_PLACE,player:0,count:1,field_mask:(~((1<<5)|(1<<6)))>>>0};
  const state={...ctx(prompt,board),summoning:{code:1340142,player:0}};
  const hard=new BotBrain({difficulty:'hard'}).decide(state);
  const medium=new BotBrain({difficulty:'medium'}).decide(state);
  assert.equal(hard.places[0].sequence,6,'Link ocupa a Zona Extra que abre uma zona própria livre');
  assert.equal(medium.places[0].sequence,5,'Médio usa a primeira zona legal');
  assert.ok(validBotResponse(prompt,hard,db));
  console.log('✓ Difícil posiciona Link conforme as setas e as zonas ocupadas');
}
{
  const guided=getPresetDeck('tcg-5ds2');
  const board={players:[empty(),empty()]};
  board.players[0].monsters[0]=card(5053103,L.MZONE,0,0);
  board.players[0].monsters[1]=card(5053103,L.MZONE,1,0);
  const prompt={...idle(),special_summons:[card(2322421,L.EXTRA)]};
  const hard=new BotBrain({difficulty:'hard',deck:guided,format:'tcg'}).decide(ctx(prompt,board));
  const medium=new BotBrain({difficulty:'medium',deck:guided,format:'tcg'}).decide(ctx(prompt,board));
  assert.equal(hard.action,A.SELECT_SPECIAL_SUMMON,'Difícil reconhece o chefe do Extra Deck no guia');
  assert.equal(medium.action,A.TO_EP,'Médio usa a conta genérica de materiais');
  console.log('✓ chefe do Extra Deck recebe valor estratégico do guia');
}
{
  const guided=getPresetDeck('tcg-5ds1'),foe=getPresetDeck('tcg-sdy');
  const hand=[63977008,11321183,48305365,13179332,487395];
  async function firstSummon(difficulty){
    const session=createDuelSession();let first=null;
    try{
      await session.start({playerName:'Bot',playerDeck:guided,opponentName:'Parceiro',opponentDeck:foe,
        registry,assets:nodeAssets,format:'tcg',pace:0,cutIns:false,watchSeat:0,testSeed:73,
        openingHands:[hand,foe.main.slice(0,5)],scenario:[{player:0,location:L.GRAVE,code:9365703}],
        seats:[{kind:'bot',name:'Bot',bot:{difficulty,onDecision(trace){
          if(first===null&&trace.prompt===M.SELECT_IDLECMD){first={response:trace.response,cards:trace.observation.prompt.summons};session.dispose();}
        }}},{kind:'local',name:'Parceiro'}]});
      assert.equal(session.getSnapshot().error,null);
      return first;
    }finally{session.dispose();}
  }
  const hard=await firstSummon('hard'),medium=await firstSummon('medium');
  assert.equal(hard?.response.action,A.SELECT_SUMMON);
  assert.equal(hard?.cards[hard.response.index].code,63977008,'motor real oferece Junk Synchron e o Difícil o escolhe');
  assert.equal(medium?.response.action,A.SELECT_SUMMON);
  assert.notEqual(medium?.cards[medium.response.index].code,63977008,'sem guia o Médio invoca um atacante maior');
  console.log('✓ abertura do guia observada na sessão real');
}
{
  const guided=getPresetDeck('tcg-5ds1'),foe=getPresetDeck('tcg-sdy'),session=createDuelSession();
  try{
    await session.start({playerName:'Bot',playerDeck:guided,opponentName:'Parceiro',opponentDeck:foe,
      registry,assets:nodeAssets,format:'tcg',pace:0,cutIns:false,watchSeat:0,testSeed:73,
      openingHands:[[63977008,11321183,48305365,13179332,487395],foe.main.slice(0,5)],
      scenario:[{player:0,location:L.GRAVE,code:9365703}],
      seats:[{kind:'bot',name:'Bot',bot:{difficulty:'hard'}},{kind:'local',name:'Parceiro'}]});
    const board=readBoardState(session.core,session.handle,0);
    assert.ok(board.players[0].monsters.some(c=>c?.code===60800381),'Difícil completa Junk Warrior em sessão real');
    console.log('✓ abertura guiada completa o Sincro em sessão real');
  }finally{session.dispose();}
}
{
  const b=new BotBrain({difficulty:'hard'}), board={players:[empty(),empty()]};
  const p=idle([card(44362883)]);
  for(let i=0;i<35;i++){board.players[0].graveSize=i;assert.equal(b.decide(ctx(p,board)).action,A.SELECT_ACTIVATE,'progresso permite sequência longa');}
  const responses=Array.from({length:30},()=>b.decide(ctx(p,board)));
  assert.ok(responses.some(r=>r.action===A.TO_EP),'repetição sem progresso termina');
  console.log('✓ sequência longa com progresso e interrupção de repetição sem progresso');
}
{
  const guided=getPresetDeck('tcg-lehd-phantom-knights'),foe=getPresetDeck('tcg-sdy'),session=createDuelSession();
  const trace=[];
  try{
    await session.start({playerName:'Bot',playerDeck:guided,opponentName:'Parceiro',opponentDeck:foe,
      registry,assets:nodeAssets,format:'tcg',pace:0,cutIns:false,watchSeat:0,testSeed:73,
      openingHands:[[90432163,19353570,99315585,83764718,61936647],foe.main.slice(0,5)],
      seats:[{kind:'bot',name:'Bot',bot:{difficulty:'hard',onDecision(t){trace.push(t);}}},{kind:'local',name:'Parceiro'}]});
    const board=readBoardState(session.core,session.handle,0);
    assert.ok(trace.some(t=>t.guideDecision==='kagemucha-sem-botas'),'bot observou a alternativa ensinada');
    assert.ok(board.players[0].monsters.some(c=>c?.code===62709239),'sem Botas, Manto e Kagemucha completam Espada Quebrada');
    console.log('✓ Cavaleiros Fantasmas sem Botas: decisão do guia completa a Xyz em sessão real');
  }finally{session.dispose();}
}
{
  const guided=getPresetDeck('tcg-lehd-phantom-knights'),foe=getPresetDeck('tcg-sdy'),session=createDuelSession();
  const trace=[];
  try{
    await session.start({playerName:'Bot',playerDeck:guided,opponentName:'Parceiro',opponentDeck:foe,
      registry,assets:nodeAssets,format:'tcg',pace:0,cutIns:false,watchSeat:0,testSeed:73,
      openingHands:[[32807846,90432163,19353570,83764718,61936647],foe.main.slice(0,5)],
      seats:[{kind:'bot',name:'Bot',bot:{difficulty:'hard',onDecision(t){trace.push(t);}}},{kind:'local',name:'Parceiro'}]});
    const board=readBoardState(session.core,session.handle,0);
    assert.ok(trace.some(t=>t.guideDecision==='reforcos-encontram-botas-para-manto'),'bot buscou a peça ensinada pelo guia');
    assert.ok(board.players[0].monsters.some(c=>c?.code===26692769),'Reforço encontra Botas e completa Bardiche com Kagemucha');
    console.log('✓ Cavaleiros Fantasmas: Reforço encontra Botas e completa Bardiche em sessão real');
  }finally{session.dispose();}
}
{
  const guided=getPresetDeck('tcg-lehd-phantom-knights'),foe=getPresetDeck('tcg-sdy'),session=createDuelSession();
  const trace=[];
  try{
    await session.start({playerName:'Bot',playerDeck:guided,opponentName:'Parceiro',opponentDeck:foe,
      registry,assets:nodeAssets,format:'tcg',pace:0,cutIns:false,watchSeat:0,testSeed:73,
      openingHands:[[56410040,36426778,56343672,98153934,77462146],foe.main.slice(0,5)],
      seats:[{kind:'bot',name:'Bot',bot:{difficulty:'hard',onDecision(t){trace.push(t);}}},{kind:'local',name:'Parceiro'}]});
    const board=readBoardState(session.core,session.handle,0);
    assert.ok(trace.some(t=>t.guideDecision==='junk-forward-com-botas'&&t.reason.startsWith('Sequência prevista pelo guia')),
      'o primeiro passo foi escolhido pelo plano de duas ações');
    assert.ok(trace.some(t=>t.guideDecision==='junk-forward-com-botas'),'bot escolheu Botas após Junk Forward');
    assert.ok(board.players[0].monsters.some(c=>c?.code===62709239),'Junk Forward e Botas formam Espada Quebrada');
    console.log('✓ Cavaleiros Fantasmas: Junk Forward e Botas completam a Xyz em sessão real');
  }finally{session.dispose();}
}
{
  const guided=getPresetDeck('tcg-lehd-destiny-hero'),foe=getPresetDeck('tcg-sdy'),session=createDuelSession();
  const trace=[];
  try{
    await session.start({playerName:'Bot',playerDeck:guided,opponentName:'Parceiro',opponentDeck:foe,
      registry,assets:nodeAssets,format:'tcg',pace:0,cutIns:false,watchSeat:0,testSeed:73,
      openingHands:[[9411399,91691605,26964762,35464895,99075257],foe.main.slice(0,5)],
      seats:[{kind:'bot',name:'Bot',bot:{difficulty:'hard',onDecision(t){trace.push(t);}}},{kind:'local',name:'Parceiro'}]});
    const choice=trace.find(t=>t.guideDecision==='broca-negra-estende-com-malicioso'&&t.prompt===M.SELECT_CARD);
    assert.ok(trace.some(t=>t.guideDecision==='broca-negra-estende-com-malicioso'&&t.reason.startsWith('Sequência prevista pelo guia')),
      'a Invocação-Normal foi escolhida pelo plano de duas ações');
    assert.ok(choice,'Broca-negra recebeu o cenário do Aprender durante o duelo');
    assert.equal(choice.observation.prompt.selects[choice.response.indicies[0]].code,9411399,
      'Broca-negra invocou Malicioso da mão real');
    console.log('✓ Destiny HERO: Broca-negra escolhe Malicioso no motor real');
  }finally{session.dispose();}
}
{
  const guided=getPresetDeck('tcg-lehd-destiny-hero'),foe=getPresetDeck('tcg-sdy'),session=createDuelSession();
  const trace=[];
  try{
    await session.start({playerName:'Bot',playerDeck:guided,opponentName:'Parceiro',opponentDeck:foe,
      registry,assets:nodeAssets,format:'tcg',pace:0,cutIns:false,watchSeat:0,testSeed:73,
      openingHands:[[40591390,63060238,73628505,64184058,91691605],foe.main.slice(0,5)],
      seats:[{kind:'bot',name:'Bot',bot:{difficulty:'hard',onDecision(t){trace.push(t);}}},{kind:'local',name:'Parceiro'}]});
    const opening=trace.find(t=>t.guideDecision==='broca-negra-com-decisor');
    assert.ok(opening,'Broca-negra foi a abertura ensinada pelo Aprender');
    const board=readBoardState(session.core,session.handle,0);
    assert.ok(board.players[0].monsters.some(c=>c?.code===91691605),'Broca-negra permanece no campo');
    assert.ok(board.players[0].monsters.some(c=>c?.code===64184058),'Decisor entrou pelo efeito de Broca-negra');
    console.log('✓ Destiny HERO: Broca-negra e Decisor formam dois corpos no motor real');
  }finally{session.dispose();}
}
{
  const guided=getPresetDeck('tcg-lehd-destiny-hero'),foe=getPresetDeck('tcg-sdy'),session=createDuelSession();
  const trace=[];
  try{
    await session.start({playerName:'Bot',playerDeck:guided,opponentName:'Parceiro',opponentDeck:foe,
      registry,assets:nodeAssets,format:'tcg',pace:0,cutIns:false,watchSeat:0,testSeed:73,
      openingHands:[[91691605,21143940,75041269,35787450,26964762],foe.main.slice(0,5)],
      seats:[{kind:'bot',name:'Bot',bot:{difficulty:'hard',onDecision(t){trace.push(t);}}},{kind:'local',name:'Parceiro'}]});
    const board=readBoardState(session.core,session.handle,0);
    assert.ok(trace.some(t=>t.guideDecision==='broca-negra-vira-lei-obscura'||t.guideLesson==='dark-law'),'bot usou a variação ensinada');
    assert.ok(trace.some(t=>t.prompt===M.SELECT_EFFECTYN&&t.observation.prompt.code===91691605&&t.response.yes===false),
      'bot preserva as Magias quando o único alvo de Broca-negra é Anjo Negro');
    assert.ok(board.players[0].monsters.some(c=>c?.code===58481572),'Mudar a Máscara invocou Lei Obscura de Broca-negra');
    console.log('✓ Destiny HERO: Broca-negra chega a Lei Obscura no motor real');
  }finally{session.dispose();}
}
{
  const guided=getPresetDeck('tcg-lehd-destiny-hero'),foe=getPresetDeck('tcg-sdy'),session=createDuelSession();
  const trace=[];
  try{
    await session.start({playerName:'Bot',playerDeck:guided,opponentName:'Parceiro',opponentDeck:foe,
      registry,assets:nodeAssets,format:'tcg',pace:0,cutIns:false,watchSeat:0,testSeed:73,
      openingHands:[[13093792,63060238,53527835,24094653,72204747],foe.main.slice(0,5)],
      seats:[{kind:'bot',name:'Bot',bot:{difficulty:'hard',onDecision(t){trace.push(t);}}},{kind:'local',name:'Parceiro'}]});
    const normal=trace.find(t=>t.prompt===M.SELECT_IDLECMD&&t.response.action===A.SELECT_SUMMON);
    assert.equal(normal?.observation.prompt.summons[normal.response.index].code,63060238,
      'sem rota completa, o bot invoca Homem em Chamas para preparar recursos');
    assert.ok(readBoardState(session.core,session.handle,0).players[0].grave.some(c=>c.code===50720316),
      'com Polimerização na mão, o envio de Névoa prepara recursos em vez de buscar uma cópia redundante');
    console.log('✓ Destiny HERO: Homem em Chamas recebe a Invocação-Normal no motor real');
  }finally{session.dispose();}
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
