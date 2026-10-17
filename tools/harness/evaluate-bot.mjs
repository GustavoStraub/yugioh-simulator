/** A/B reproduzível: sementes reservadas, pares com assentos invertidos e IC Wilson. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {OcgDuelMode} from '@n1xx1/ocgcore-wasm';
import {BotBrain} from '@/lib/duel/bot/bot-brain';
import {loadBotProfile} from '@/lib/duel/bot/deck-profile';
import {timingPercentiles} from '@/lib/duel/bot/decision-trace';
import {OfficialCardDb} from '@/lib/duel/official-card-data';
import {readBoardState} from '@/lib/duel/board-state';
import {autoResponseFor} from '@/lib/duel/auto-response';
import {createDuel,Zone} from './duel.mjs';
import {createBotObserver} from './bot-observer.mjs';
const rounds=Number(process.env.BOT_ROUNDS??8);
const seedOffset=Number(process.env.BOT_SEED_OFFSET??0);
const format=process.env.BOT_FORMAT??'tcg';
const ids=(process.env.BOT_DECKS??'tcg-sdaz,tcg-lehd-aesir,tcg-lehd-destiny-hero,tcg-lehd-phantom-knights').split(',');
const all=JSON.parse(readFileSync(format==='tcg'?'src/data/preset-decks-tcg.json':'src/data/preset-decks.json','utf8'));
const decks=all.filter(d=>ids.includes(d.id));
if(decks.length!==ids.length)throw new Error(`Decks não encontrados: ${ids.filter(id=>!decks.some(d=>d.id===id))}`);
const baseline=process.env.BOT_BASELINE?(await import(process.env.BOT_BASELINE)).BotBrain:null;
const comparisons=process.env.BOT_COMPARISONS?process.env.BOT_COMPARISONS.split(',').map(x=>x.split(':')):baseline?[['baseline','baseline'],['medium','baseline'],['hard','baseline'],['medium','easy'],['hard','medium']]:[['medium','easy'],['hard','medium']];
const db=new OfficialCardDb(JSON.parse(readFileSync('src/data/card-db.json','utf8')));
function shuffled(cards,seed){let n=Number(seed)>>>0;const a=[...cards];for(let i=a.length-1;i>0;i--){n=(Math.imul(n,1664525)+1013904223)>>>0;const j=Math.floor(n/4294967296*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function ci(wins,n){if(!n)return [0,1];const z=1.96,p=wins/n,den=1+z*z/n,center=(p+z*z/(2*n))/den,half=z*Math.sqrt((p*(1-p)+z*z/(4*n))/n)/den;return [center-half,center+half];}
const rows=[];
for(const [left,right] of comparisons){
 for(let di=0;di<decks.length;di++)for(const mirror of [true,false]){
  const a=decks[di],b=mirror?a:decks[(di+1)%decks.length];
  const row={format,left,right,deck:a.id,opponent:b.id,wins:0,losses:0,draws:0,inconclusive:0,rejected:0,fallbacks:0,decisions:0,limits:0,errors:0,seats:[{games:0,wins:0},{games:0,wins:0}],times:[],outcomes:{}};
  for(let r=0;r<rounds;r++)for(const seat of [0,1]){
   // Os mesmos decks e compras ficam nos mesmos assentos. Só os cérebros
   // invertem; as comparações usam rigorosamente estas mesmas sementes.
   const seed=BigInt(90001+seedOffset+r*97+di*1009+(mirror?0:5003));
   const lists=[a,b];
   const duel=await createDuel({mode:format==='tcg'?OcgDuelMode.MODE_MR5:OcgDuelMode.MODE_GOAT,
    decks:lists.map((d,i)=>shuffled(d.main,seed+BigInt(i*31))),
    place:lists.flatMap((d,player)=>d.extra.map(code=>({player,zone:Zone.EXTRA,code}))),seed,startingDraw:5});
   const observer=createBotObserver(duel,format);
   const brains=await Promise.all(lists.map(async(d,i)=>{const kind=i===seat?left:right;return kind==='baseline'?new baseline():new BotBrain({difficulty:kind,deck:d,format,profile:await loadBotProfile(d,format),seed:31});}));
   let outcome;
   try{outcome=duel.run(p=>{
    const state=observer(p),automatic=autoResponseFor(state.prompt,{resolvingCode:state.resolvingEffect?.code});if(automatic)return automatic;
    const me=p.player===1?1:0,cache=new Map();
    return brains[me].decide({...state,me,cardDb:db,lifePoints:duel.lifePoints,readBoard(full){if(!cache.has(full))cache.set(full,readBoardState(duel.core,duel.handle,me,!full));return cache.get(full);}});
   });
   const decided=outcome==='WIN'&&[0,1].includes(duel.winner);
   if(decided){if(duel.winner===seat){row.wins++;row.seats[seat].wins++;}else row.losses++;}
   else if(outcome==='WIN'&&duel.winner===2)row.draws++;else row.inconclusive++;
   row.seats[seat].games++;row.rejected+=duel.retriesTotal;row.errors+=duel.errors.length;row.limits+=outcome==='MAX_STEPS'?1:0;
   row.outcomes[outcome]=(row.outcomes[outcome]??0)+1;
   const diag=brains[seat].diagnostics;if(diag){row.fallbacks+=diag.fallbacks;row.decisions+=diag.decisions;row.times.push(...diag.timings);}
   }finally{duel.destroy();}
  }
  row.ci95=ci(row.wins,row.wins+row.losses);row.cpu=timingPercentiles(row.times);delete row.times;rows.push(row);
  console.log(`${left} × ${right} · ${a.id} × ${b.id}: ${row.wins}/${row.wins+row.losses}, inconclusivas ${row.inconclusive}`);
 }
}
const summary=comparisons.map(([left,right])=>{const rs=rows.filter(r=>r.left===left&&r.right===right),sum=k=>rs.reduce((s,r)=>s+r[k],0);return{left,right,wins:sum('wins'),losses:sum('losses'),draws:sum('draws'),inconclusive:sum('inconclusive'),rejected:sum('rejected'),fallbacks:sum('fallbacks'),ci95:ci(sum('wins'),sum('wins')+sum('losses'))};});
const output={protocol:1,rounds,seedOffset,seedRange:'90001 + rodada*97 + deck*1009 + confronto*5003',format,summary,rows};
mkdirSync('.cache/bot-evaluation',{recursive:true});const target=process.env.BOT_REPORT??`.cache/bot-evaluation/${format}.json`;writeFileSync(target,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));console.log(`Relatório: ${target}`);
