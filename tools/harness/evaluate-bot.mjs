/** Pares por seed, compras fixas por assento, dados privados e IC por pares. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { OcgDuelMode } from '@n1xx1/ocgcore-wasm';
import { BotBrain } from '@/lib/duel/bot/bot-brain';
import { loadBotProfile } from '@/lib/duel/bot/deck-profile';
import { timingPercentiles } from '@/lib/duel/bot/decision-trace';
import { OfficialCardDb } from '@/lib/duel/official-card-data';
import { readBoardState } from '@/lib/duel/board-state';
import { createDuel, Zone } from './duel.mjs';
import { SCRIPTS_DIR } from './env.mjs';
import { createBotObserver } from './bot-observer.mjs';
import { approval, scoreGames, pairedInterval } from './bot-evaluation-protocol.mjs';
import { runtimeIdentity, loadBaseline, hash, stringify, promptHash } from './bot-evaluation-artifacts.mjs';

const rounds = Number(process.env.BOT_ROUNDS ?? 8);
const onlyGame = process.env.BOT_GAME_ID;
const gameKeys = process.env.BOT_GAME_KEYS ? new Set(process.env.BOT_GAME_KEYS.split(',')) : null;
let panel = process.env.BOT_PANEL ?? 'development';
if (!['development','validation'].includes(panel)) throw new Error('BOT_PANEL inválido');
if ((onlyGame || gameKeys) && panel === 'validation') throw new Error('Investigações usam o painel de desenvolvimento');
if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error('BOT_ROUNDS deve ser inteiro positivo');
const seedOffset = Number(process.env.BOT_SEED_OFFSET ?? (panel === 'validation' ? 10_000_000 : 0));
if (!Number.isSafeInteger(seedOffset) || seedOffset < 0 || (panel === 'validation' && seedOffset !== 10_000_000)
  || (panel === 'development' && seedOffset >= 10_000_000)) throw new Error('Faixa de seeds incompatível com o painel');
const format = process.env.BOT_FORMAT ?? 'tcg';
if (!['tcg','goat'].includes(format)) throw new Error('Formato inválido');
const defaults = format === 'tcg' ? 'tcg-sdaz,tcg-lehd-aesir,tcg-lehd-destiny-hero,tcg-lehd-phantom-knights'
  : 'starter-yugi,starter-kaiba,structure-zombie-madness,structure-fury';
const ids = (process.env.BOT_DECKS ?? defaults).split(',');
const all = JSON.parse(readFileSync(format === 'tcg' ? 'src/data/preset-decks-tcg.json' : 'src/data/preset-decks.json','utf8'));
const decks = ids.map(id => { const deck = all.find(d => d.id === id); if (!deck) throw new Error(`Deck ausente: ${id}`); return deck; });
const baseline = process.env.BOT_BASELINE ? await loadBaseline(process.env.BOT_BASELINE) : null;
const comparisons = process.env.BOT_COMPARISONS ? process.env.BOT_COMPARISONS.split(',').map(x => x.split(':'))
  : baseline ? [['medium','baseline'],['hard','baseline-hard'],['hard','medium']] : [['medium','easy'],['hard','medium']];
const policies = new Set(['easy','medium','hard','hard-experimental','hard-candidates-only','hard-tactics-only','baseline','baseline-easy','baseline-medium','baseline-hard','hard-no-sequence','hard-no-state','hard-no-memory','hard-no-recovery']);
for (const comparison of comparisons) if (comparison.length !== 2 || comparison.some(kind => !policies.has(kind) || kind.startsWith('baseline') && !baseline)) throw new Error(`Política inválida: ${comparison}`);
const matrix = process.env.BOT_MATRIX ?? 'adjacent';
if (!['adjacent','full'].includes(matrix)) throw new Error('BOT_MATRIX inválida');
const matchups = matrix === 'full' ? decks.flatMap(a => decks.map(b => [a,b]))
  : decks.flatMap((a,i) => decks.length === 1 ? [[a,a]] : [[a,a],[a,decks[(i+1)%decks.length]]]);
if (seedOffset + (rounds-1)*97 + (matchups.length-1)*1009 >= (panel === 'validation' ? 20_000_000 : 10_000_000)) throw new Error('Seeds atravessam o limite do painel');
if (panel === 'validation' && rounds*matchups.length < 256) throw new Error('Reserve pelo menos 256 pares antes da avaliação final');
const target = process.env.BOT_REPORT ?? `.cache/bot-evaluation/${format}.json`;
const replayDir = process.env.BOT_REPLAY_DIR ? resolve(process.env.BOT_REPLAY_DIR) : null;
if (replayDir && !replayDir.startsWith(resolve('.cache') + '/')) throw new Error('Replays privados devem ficar em .cache/');
if (replayDir && existsSync(replayDir)) throw new Error('Diretório de replay já existe; escolha um novo nome');
if (replayDir) mkdirSync(replayDir, { recursive:true, mode:0o700 });
const identity = runtimeIdentity(SCRIPTS_DIR);
const control = process.env.BOT_CONTROL_REPORT ? JSON.parse(readFileSync(process.env.BOT_CONTROL_REPORT,'utf8')) : null;
if (control) for (const key of ['dataHash','coreHash','scriptsHash','patchesHash','patchesDisabled']) {
  if (control.identity[key] !== identity[key]) throw new Error(`Controle usa outro ambiente: ${key}`);
}
// Uma amostra usada para orientar alterações deixa de ser reservada. O recibo impede reutilização silenciosa.
const receipt = '.cache/bot-evaluation/validation-used.json';
if (panel === 'validation') {
  if (existsSync(receipt)) throw new Error(`Painel reservado já utilizado: ${receipt}. Use desenvolvimento para novos ajustes.`);
  mkdirSync(dirname(receipt),{recursive:true});
  writeFileSync(receipt,JSON.stringify({ identity, rounds, ids, comparisons, matrix, seedOffset },null,2));
}
const db = new OfficialCardDb(JSON.parse(readFileSync('src/data/card-db.json','utf8')));
export function shuffled(cards,seed) {
  let n = Number(seed) >>> 0; const result = [...cards];
  for(let i=result.length-1;i>0;i--) { n=(Math.imul(n,1664525)+1013904223)>>>0; const j=Math.floor(n/4294967296*(i+1)); [result[i],result[j]]=[result[j],result[i]]; }
  return result;
}
const games = [], rows = [];
for (const [left,right] of comparisons) for (let matchup=0;matchup<matchups.length;matchup++) {
  const [a,b] = matchups[matchup];
  const rowGames = [], times = [];
  const row = { format,left,right,deck:a.id,opponent:b.id,rejected:0,fallbacks:0,decisionUses:0,decisions:0,limits:0,errors:0,
    seats:[{games:0,wins:0},{games:0,wins:0}],sources:{},fallbackByPrompt:{},outcomes:{},
    ...(process.env.BOT_TRACE_PROMPTS==='1'?{promptSamples:[]}:{}), ...(process.env.BOT_TRACE_IDLE==='1'?{idleSamples:[]}:{} ) };
  for (let round=0;round<rounds;round++) for (const seat of [0,1]) {
    // Seed não depende da comparação ou da política. Cada par conserva listas e compras nos mesmos assentos.
    const seed = BigInt(90001 + seedOffset + round*97 + matchup*1009);
    const pair = `${format}:${a.id}:${b.id}:${seed}`;
    const id = `${left}-${right}-${matchup}-${round}-${seat}`;
    if (onlyGame && id !== onlyGame) continue;
    if (gameKeys && !gameKeys.has(`${matchup}-${round}-${seat}`)) continue;
    const lists = [a,b], main = lists.map((d,i)=>shuffled(d.main,seed+BigInt(i*31)));
    const duel = await createDuel({mode:format==='tcg'?OcgDuelMode.MODE_MR5:OcgDuelMode.MODE_GOAT,
      decks:main,place:lists.flatMap((d,player)=>d.extra.map(code=>({player,zone:Zone.EXTRA,code}))),seed,startingDraw:5});
    const observer = createBotObserver(duel,format), responses = [], traces = [], gameTimes = [];
    let observedTurn = 0;
    const brains = await Promise.all(lists.map(async(d,i)=> {
      const kind = i===seat ? left : right;
      const frozen = kind.startsWith('baseline');
      const experimental = ['hard-experimental','hard-candidates-only','hard-no-state','hard-no-memory','hard-no-recovery'].includes(kind);
      const Brain = frozen ? baseline.brain.BotBrain : BotBrain;
      return new Brain({ difficulty:frozen?kind.split('-')[1]??'medium':kind.startsWith('hard-')?'hard':kind,
        sequencePlanning:kind!=='hard-no-sequence', candidateComparison:experimental,
        tacticalModel:kind==='hard-tactics-only'||experimental&&kind!=='hard-candidates-only',
        stateEvaluation:experimental&&!['hard-no-state','hard-candidates-only'].includes(kind),
        opponentMemory:kind!=='hard-no-memory', recoveryPlanning:kind!=='hard-no-recovery',
        deck:d, format, profile:await (frozen?baseline.profiles.loadBotProfile:loadBotProfile)(d,format),seed:31,
        onDecision:trace=> {
          if (replayDir && (trace.source!=='automatic'||process.env.BOT_TRACE_AUTOMATIC==='1')) traces.push({seat:i,promptIndex:responses.length,...trace});
          if (i!==seat) return;
          row.sources[trace.source??'legacy']=(row.sources[trace.source??'legacy']??0)+1;
          if(trace.fallback) row.fallbackByPrompt[trace.prompt]=(row.fallbackByPrompt[trace.prompt]??0)+1;
          if(trace.guideDecision) row.decisionUses++;
          if (row.promptSamples && row.promptSamples.length<60) row.promptSamples.push({type:trace.prompt,turn:trace.turn,response:trace.response,reason:trace.reason,source:trace.source});
          if (row.idleSamples && trace.prompt===11 && row.idleSamples.length<150) row.idleSamples.push({turn:trace.turn,response:trace.response,guide:trace.guideDecision,route:trace.route,reason:trace.reason});
        } });
    }));
    let outcome;
    try {
      outcome = duel.run(prompt=> {
        const decisionStartedAt = performance.now();
        const state = observer(prompt), me = prompt.player===1?1:0, cache = new Map();
        observedTurn = state.turnCount;
        const context = {...state,me,decisionStartedAt,cardDb:db,lifePoints:duel.lifePoints,readBoard(full) {
          if(!cache.has(full)) cache.set(full,readBoardState(duel.core,duel.handle,me,!full)); return cache.get(full);
        }};
        const kind = me===seat?left:right;
        // A baseline mantém seu próprio respondedor e suas escolhas sem modelo.
        const automatic = kind.startsWith('baseline') ? baseline.auto.autoResponseFor(state.prompt,{resolvingCode:state.resolvingEffect?.code}) : null;
        const response = automatic ?? brains[me].decide(context);
        if(me===seat) gameTimes.push(performance.now()-decisionStartedAt);
        if(replayDir) responses.push({seat:me,promptHash:promptHash(prompt),response});
        return response;
      });
      const score = outcome==='WIN' ? duel.winner===2?0.5:duel.winner===seat?1:[0,1].includes(duel.winner)?0:null : null;
      const game = {id,pair,seed:String(seed),round,seat,firstPlayer:0,policies:seat===0?[left,right]:[right,left],decks:lists.map(d=>d.id),
        listHashes:lists.map(d=>hash(stringify(d))),left,right,score,winner:duel.winner,outcome,rejected:duel.retriesTotal,
        errors:duel.errors.length,limits:Number(outcome==='MAX_STEPS'),steps:duel.steps,turns:observedTurn,cpu:timingPercentiles(gameTimes),
        replay:replayDir?join(replayDir,`${id}.json`):null};
      if(replayDir) writeFileSync(game.replay,stringify({schema:1,identity,game,format,lists,main,startingDraw:5,responses,traces})+'\n',{mode:0o600});
      games.push(game); rowGames.push(game);
      row.seats[seat].games++; if(score===1) row.seats[seat].wins++;
      row.rejected+=game.rejected; row.errors+=game.errors; row.limits+=game.limits;
      row.outcomes[outcome]=(row.outcomes[outcome]??0)+1;
      const diag=brains[seat].diagnostics;
      if(diag) { row.fallbacks+=diag.fallbacks; row.decisions+=diag.decisions; times.push(...gameTimes); }
    } finally { duel.destroy(); }
  }
  if (!rowGames.length) continue;
  Object.assign(row,scoreGames(rowGames),{ci95:pairedInterval(rowGames),cpu:timingPercentiles(times)}); rows.push(row);
  console.log(`${left} × ${right} · ${a.id} × ${b.id}: ${row.wins}/${row.wins+row.losses}, inconclusivas ${row.inconclusive}`);
}
const summary = comparisons.map(([left,right])=> {
  const selected=games.filter(g=>g.left===left&&g.right===right), selectedRows=rows.filter(r=>r.left===left&&r.right===right);
  const controlGames = control?.games.filter(game=>game.left===right&&game.right===right) ?? [];
  if (controlGames.length && right.startsWith('baseline') && control.baseline?.hash !== baseline?.hash) throw new Error('Controle usa outra baseline');
  return {left,right,...approval(selected,panel,controlGames),rejected:selected.reduce((sum,g)=>sum+g.rejected,0),
    fallbacks:selectedRows.reduce((sum,r)=>sum+r.fallbacks,0), decisionUses:selectedRows.reduce((sum,r)=>sum+r.decisionUses,0)};
});
if (!games.length) throw new Error('Nenhuma partida selecionada');
const output={protocol:2,panel,rounds,seedOffset,seedFormula:'90001 + offset + round*97 + matchup*1009',matrix,format,identity,
  baseline:baseline?{hash:baseline.hash,revision:baseline.manifest.revision}:null,
  control:control?{report:process.env.BOT_CONTROL_REPORT,hash:hash(stringify(control))}:null,summary,rows,games};
mkdirSync(dirname(target),{recursive:true}); writeFileSync(target,stringify(output)+'\n');
console.log(JSON.stringify(summary,null,2)); console.log(`Relatório: ${target}`);
