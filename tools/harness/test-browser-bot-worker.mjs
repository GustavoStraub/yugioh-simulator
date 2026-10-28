/** Chrome real com viewport móvel e CPU reduzida; métricas agregadas sem observações privadas. */
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {cpus} from 'node:os';
import {launchChrome,openPage} from './browser.mjs';
const {child,port}=await launchChrome(),page=await openPage(port),id=`bot-worker-${Date.now()}`;
const base=process.env.APP_URL??'http://127.0.0.1:3000';
const preset=process.env.BOT_PRESET??'tcg-sdaz';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(js){for(let i=0;i<400;i++){if(await page.evaluate(js).catch(()=>false))return;await delay(150);}throw Error(`Timeout: ${js}`);}
async function choose(label,value){await page.evaluate(`document.querySelector('button[aria-label="${label}"]').click();`);await until(`return Boolean(document.querySelector('[popover]:popover-open [data-value="${value}"]'));`);await page.evaluate(`document.querySelector('[popover]:popover-open [data-value="${value}"]').click();`);}
try{
 await page.setViewport(390,844,{mobile:true,touch:true});await page.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`
  window.__analysis={times:[],ticks:0,workers:0,errors:[],ready:0,sliferActive:false,heroActive:false,phantomActive:false,lessons:[]};
  const Native=window.Worker;
  window.Worker=class extends Native{
   constructor(...args){super(...args);this.pending=new Map();window.__analysis.workers++;
    this.addEventListener('error',e=>window.__analysis.errors.push(e.message));
    this.addEventListener('message',e=>{const x=e.data;if(x.kind==='ready')window.__analysis.ready++;
     if(x.kind==='result'){window.__analysis.sliferActive ||= x.trace.capabilities?.sliferStrategy===true;window.__analysis.heroActive ||= x.trace.capabilities?.heroStrategy===true;window.__analysis.phantomActive ||= x.trace.capabilities?.phantomStrategy===true;if(x.trace.guideLesson)window.__analysis.lessons.push(x.trace.guideLesson);const p=this.pending.get(x.revision);if(p){window.__analysis.times.push({total:performance.now()-p.start+p.extraction,extraction:p.extraction,analysis:Math.max(0,x.trace.elapsedMs-p.extraction),ticks:window.__analysis.ticks-p.ticks});this.pending.delete(x.revision);}}
     if(x.kind==='error')window.__analysis.errors.push(x.message);
    });
   }
   postMessage(x,...args){if(x.kind==='init')x={...x,config:{...x.config,candidateComparison:true}};
    if(x.kind==='decide')this.pending.set(x.revision,{start:performance.now(),extraction:x.observation.extractionMs,ticks:window.__analysis.ticks});
    super.postMessage(x,...args);
   }
  };
  setInterval(()=>window.__analysis.ticks++,1);
 `});
 await page.goto(base+'/duel');
 await page.evaluate(`localStorage.setItem('yugioh-goat-profile-v1',JSON.stringify({id:${JSON.stringify(id)},name:'Worker móvel'}));localStorage.setItem('yugioh-goat-tips-v1',JSON.stringify({off:true,seen:[]}));localStorage.setItem('yugioh-goat-duel-prefs-v1',JSON.stringify({speed:'faster',cutIns:false,holograms:'off',chainMode:'auto'}));`);
 await page.goto(base+'/duel');await until(`return Boolean(document.querySelector('button[aria-label="Seu deck"]'));`);
 await choose('Seu deck','tcg-sdy');await choose('Deck do bot',preset);
 await page.evaluate(`document.querySelector('[data-first-turn="bot"]').click();`);
 await page.clickText('Iniciar duelo vs bot');await until(`return Boolean(document.querySelector('[data-turn-owner="me"]'));`);
 const metrics=await page.evaluate(`return {...window.__analysis,userAgent:navigator.userAgent};`);
 assert.ok(metrics.workers>0&&metrics.ready>0,'worker carregou no bundle do navegador');
 assert.ok(metrics.times.length>=5,'decisões reais do Difícil');assert.deepEqual(metrics.errors,[]);assert.deepEqual(page.errors,[]);
 assert.ok(metrics.times.some(t=>t.ticks>0),'event loop atende eventos enquanto worker analisa');
 if(preset==='tcg-egs1')assert.equal(metrics.sliferActive,true,'política do guia Slifer carregada no worker do navegador');
 if(preset==='tcg-lehd-destiny-hero')assert.equal(metrics.heroActive,true,'política HERO carregada no worker');
 if(preset==='tcg-lehd-phantom-knights')assert.equal(metrics.phantomActive,true,'política Cavaleiros Fantasmas carregada no worker');
 const percentile=(key,p)=>{const s=metrics.times.map(x=>x[key]).sort((a,b)=>a-b);return s[Math.ceil(s.length*p)-1];};
 const report={device:{mode:'Chrome desktop, emulação móvel 390×844, touch, CPU 4× mais lenta; não é telefone físico',cpu:cpus()[0]?.model,userAgent:metrics.userAgent},deck:preset,sliferActive:metrics.sliferActive,heroActive:metrics.heroActive,phantomActive:metrics.phantomActive,guideLessons:[...new Set(metrics.lessons)],policy:'hard candidateComparison=true',decisions:metrics.times.length,workerErrors:metrics.errors,mainThreadResponded:true,totalMs:{p95:percentile('total',.95),p99:percentile('total',.99)},extractionMs:{p95:percentile('extraction',.95),p99:percentile('extraction',.99)},analysisMs:{p95:percentile('analysis',.95),p99:percentile('analysis',.99)}};
 assert.ok(report.totalMs.p95<=100,`p95 ${report.totalMs.p95}ms`);assert.ok(report.totalMs.p99<=300,`p99 ${report.totalMs.p99}ms`);
 mkdirSync('.cache/bot-evaluation',{recursive:true});writeFileSync('.cache/bot-evaluation/browser-worker.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await page.close();child.kill();const f=`.data/decks/${id}.json`;if(existsSync(f)){assert.equal(JSON.parse(readFileSync(f,'utf8')).profile.id,id);rmSync(f);}}
