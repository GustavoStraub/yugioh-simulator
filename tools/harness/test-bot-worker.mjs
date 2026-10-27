import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cpus} from 'node:os';
import {BotBrain} from '@/lib/duel/bot/bot-brain';
import {BotAnalysisController,createBotPilot} from '@/lib/duel/bot/analysis-controller';
import {OfficialCardDb} from '@/lib/duel/official-card-data';
import {nodeBotAnalysisTransport} from '@/server/duel/bot-analysis-transport';
import {getPresetDeck} from '@/lib/data/preset-decks-catalog';
import {loadBotProfile} from '@/lib/duel/bot/deck-profile';
import {timingPercentiles} from '@/lib/duel/bot/decision-trace';
import {parse} from './bot-evaluation-artifacts.mjs';
const fixture=parse(readFileSync('tools/harness/fixtures/bot-over-preservation.json','utf8')).observation;
const cards=new OfficialCardDb(JSON.parse(readFileSync('src/data/card-db.json','utf8'))),deck=getPresetDeck('tcg-sdaz');
const config={difficulty:'hard',candidateComparison:true,execution:'worker',deck,format:'tcg',profile:await loadBotProfile(deck,'tcg'),seed:31};
const ctx=()=>({...fixture,phase:fixture.phase,turnPlayer:fixture.me,turnCount:2,cardDb:cards,readBoard:()=>fixture.board,decisionStartedAt:performance.now()});
const times=[],traces=[];
const pilot=await createBotPilot({...config,onDecision:t=>traces.push(t)},cards,nodeBotAnalysisTransport);
try {
  const reference=new BotBrain({...config,onDecision:undefined});
  let ticks=0;const pulse=setInterval(()=>ticks++,1);
  try {for(let i=0;i<64;i++){
    const c=ctx();c.turnCount=2+i;const expected=reference.decide(c);c.decisionStartedAt=performance.now();
    assert.deepEqual(await pilot.decide(c),expected,'mesma política e observação no worker');
    times.push(performance.now()-c.decisionStartedAt);
  }} finally {clearInterval(pulse);}
  assert.ok(ticks>0,'event loop principal continua atendendo eventos');
  assert.ok(traces.every(t=>t.execution.mode==='worker'),'não usou fallback local');
  assert.ok(traces.every(t=>t.execution.totalMs>=t.execution.analysisMs));
} finally {pilot.dispose();}
// Resultados de uma revisão cancelada nunca voltam ao dono do core.
{
  let receive,stopped=false,callbacks=0;
  const fake={listen(fn){receive=fn;return()=>{};},send(request){if(request.kind==='init')queueMicrotask(()=>receive({kind:'ready'}));},terminate(){stopped=true;}};
  const controller=new BotAnalysisController({...config,onDecision(){callbacks++;}},fake,cards);
  await controller.initialize();const pending=controller.decide(ctx());await new Promise(resolve=>setTimeout(resolve,0));controller.dispose();
  receive({kind:'result',revision:1,response:{type:1,action:7,index:null},trace:{}});
  assert.equal(await pending,null);assert.equal(callbacks,0);assert.equal(stopped,true);
}
// Falha de transporte é recuperada e atribuída, sem travar a sessão.
{
  let receive;
  const fake={listen(fn){receive=fn;return()=>{};},send(request){queueMicrotask(()=>receive(request.kind==='init'?{kind:'ready'}:{kind:'error',revision:request.revision,message:'falha injetada'}));},terminate(){}};
  let source;const controller=new BotAnalysisController({...config,onDecision(t){source=t.source;}},fake,cards);
  await controller.initialize();assert.ok(await controller.decide(ctx()));assert.equal(source,'fallback-error');controller.dispose();
}
console.log(JSON.stringify({device:{platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model,node:process.version},decisions:times.length,totalMs:timingPercentiles(times)},null,2));
console.log('✓ worker real, paridade, revisão, cancelamento, recuperação e responsividade');
