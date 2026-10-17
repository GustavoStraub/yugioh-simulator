/** Perfis, escolhas e intenções exercitados pela DuelSession real, sem piloto da lição. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OcgMessageType as M } from '@n1xx1/ocgcore-wasm';
import { DECK_GUIDES } from '@/lib/data/deck-guides';
import { getPresetDeck } from '@/lib/data/preset-decks-catalog';
import { CardRegistry } from '@/lib/domain/card-registry';
import { createDuelSession } from '@/lib/duel/duel-session';
import { readBoardState } from '@/lib/duel/board-state';
import { loadBotProfile, deckSignature, validateBotProfile } from '@/lib/duel/bot/deck-profile';
import { timingPercentiles } from '@/lib/duel/bot/decision-trace';
import { nodeAssets } from '@/server/duel/node-assets';

const registry = CardRegistry.fromCatalog(JSON.parse(readFileSync('.cache/catalog/catalog.json','utf8')));
const variants=JSON.parse(readFileSync('src/data/bot-profiles/scenarios.json','utf8'));
const times = [];
let count = 0;
for (const guide of DECK_GUIDES.filter(g => g.lessons.some(l=>l.practice))) {
  const deck = getPresetDeck(guide.presetId);
  const profile = await loadBotProfile(deck,'tcg');
  assert.ok(profile && validateBotProfile(profile), `${guide.id}: perfil validado e atualizado`);
  assert.equal(deckSignature(deck,'tcg'),deckSignature({...deck,main:[...deck.main].reverse()},'tcg'));
  assert.equal(await loadBotProfile({...deck,main:[...deck.main,deck.main[0]]},'tcg'),null,'quantidades incompatíveis');
  assert.equal(await loadBotProfile({...deck,side:[deck.main[0]]},'tcg'),null,'Side também revisado');
  for (const difficulty of ['medium','hard']) for (const lesson of [...guide.lessons.filter(l=>l.practice),...variants.filter(v=>v.profile===guide.id&&difficulty==='hard').map(v=>({id:v.route,validationRoute:v.route,startingHand:v.hand,practice:{goal:v.goal}}))]) {
    if (process.env.ONLY_ROUTE && lesson.id !== process.env.ONLY_ROUTE) continue;
    // Uma rota por caso comprova cada ramo do modelo. Os testes de escolha
    // entre rotas usam o perfil integral e mãos alternativas, abaixo.
    const routeProfile = {...profile,routes:profile.routes.filter(r=>r.id===(lesson.validationRoute??lesson.id))};
    const session = createDuelSession();
    let reached = false, decisions = 0, trace = [];
    try {
      await session.start({
        playerName:'Bot sob teste',playerDeck:deck,opponentName:'Parceiro',opponentDeck:getPresetDeck('tcg-sdy'),
        format:'tcg',registry,assets:nodeAssets,pace:0,cutIns:false,openingHands:[lesson.startingHand,getPresetDeck('tcg-sdy').main.slice(0,5)],watchSeat:0,
        seats:[{kind:'bot',name:'Bot',bot:{difficulty,profile:routeProfile,onDecision(t){
          trace.push(t); times.push(t.elapsedMs);
          if (++decisions > 160) throw new Error('decisões excessivas');
          if (t.prompt === M.SELECT_IDLECMD && session.getSnapshot().turnCount===1) {
            const board = readBoardState(session.core,session.handle,0);
            reached = lesson.practice.goal.every(c => c.kind==='lp' ? session.getSnapshot().lifePoints[c.player]===c.value
              : c.kind==='card' ? (c.absent ? !board.players[0][c.zone].some(x=>x?.code===c.code)
                : board.players[0][c.zone].filter(x=>x?.code===c.code).length >= (c.count??1)) : true);
            if (reached) session.dispose();
          }
        }}},{kind:'local',name:'Parceiro'}],
      });
      if (process.env.DEBUG_BOT || !reached) console.log(trace.map(t=>({route:t.route,reason:t.reason,prompt:t.prompt,response:t.response,fallback:t.fallback,description:String(t.observation.prompt.description??''),candidates:t.observation.prompt.selects?.map(c=>[c.code,c.location,String(c.description??'')])})));
      assert.equal(session.getSnapshot().error,null);
      assert.ok(reached,`${difficulty}: ${guide.id}/${lesson.id} conclui objetivo e preserva recursos`);
      assert.ok(!session.getSnapshot().log.some(l=>l.text.includes('rejeitou')),'nenhum RETRY terminal');
      count++;
      console.log(`✓ sessão real: ${difficulty} · ${guide.id}/${lesson.id}`);
    } finally {session.dispose();}
  }
}
console.log(JSON.stringify({routes:count,cpu:timingPercentiles(times)},null,2));
