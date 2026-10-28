/** Treinos de interação de Cavaleiros Fantasmas, jogados pela interface e pelas indicações GUIA. */
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {launchChrome,openPage} from './browser.mjs';
const onlyLesson=process.env.LESSON_ID;
const guides=['cavaleiros-fantasmas'].map(id=>JSON.parse(readFileSync(`src/data/deck-guides/herois-lendarios-${id}.json`,'utf8'))).filter(guide=>!onlyLesson||guide.lessons.some(lesson=>lesson.id===onlyLesson));
assert.ok(guides.length,'o filtro seleciona ao menos um exercício');

const BASE=process.env.APP_URL??'http://127.0.0.1:3000',OUT='.cache/shots/learning';
mkdirSync(OUT,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const {child,port}=await launchChrome(), page=await openPage(port);
async function until(expr){for(let i=0;i<300;i++){if(await page.evaluate(expr).catch(()=>false))return;await sleep(100);}throw Error(`Timeout: ${expr}`);}
try{
 await page.setViewport(1440,1000);
 await page.goto(`${BASE}/aprender`);
 await page.evaluate(`localStorage.setItem('yugioh-goat-profile-v1',JSON.stringify({id:'legendary-browser',name:'Aprendiz'}));localStorage.setItem('yugioh-goat-tips-v1',JSON.stringify({off:true,seen:[]}));return true;`);
 for(const guide of guides){
  for(const lesson of guide.lessons){
   await page.goto(`${BASE}/aprender/${guide.id}?licao=${lesson.id}`);
   await until(`return document.querySelector('[data-lesson]')?.dataset.lesson===${JSON.stringify(lesson.id)};`);
   assert.equal(await page.evaluate(`return document.querySelector('[data-lesson]').dataset.lessonKind;`),'practice');
  }
  const selectedLessons=guide.lessons.filter(lesson=>onlyLesson?lesson.id===onlyLesson:['bracadeira-abre-dardo-amaldicoado','rebeliao-sem-materiais-vira-requiem'].includes(lesson.id));
  for(const lesson of selectedLessons){
   await page.goto(`${BASE}/aprender/${guide.id}/treinar/${lesson.id}`);
   await until(`return document.querySelector('[data-phase-button]')?.textContent.includes('Main1')&&!document.querySelector('[data-processing="1"]');`);
   const hand=await page.evaluate(String.raw`return [...document.querySelectorAll('[data-zone^="0:2:"] img')].map(img=>Number(img.src.split('/').pop().match(/^(\d+)\./)?.[1])).sort((a,b)=>a-b);`);
   assert.deepEqual(hand,[...lesson.startingHand].sort((a,b)=>a-b));
   let complete=false;
   const history=[];
   for(let i=0;i<240;i++){
    await sleep(100);
    const result=await page.evaluate(String.raw`
     const panel=document.querySelector('[data-practice-lesson]');
     if(panel?.dataset.practiceCompleted==='true')return {done:true};
     if(document.querySelector('[data-processing="1"]'))return {did:'wait'};
     const stage=Number(panel?.dataset.practiceStage),targets=${JSON.stringify(lesson.practice.stages)}[stage]?.targets??[];
     const visible=e=>e&&e.offsetParent!==null, code=e=>Number((e?.querySelector('img')?.src??'').split('/').pop().match(/^(\d+)\./)?.[1]);
     const buttons=[...document.querySelectorAll('button')].filter(e=>visible(e)&&!e.disabled),exact=t=>buttons.find(e=>e.innerText.trim()===t);
     const click=(e,did)=>{if(!e)return null;e.click();return {did,stage};};
     let result;
     if(result=click(exact('Sim'),'yes'))return result;
     const menu=document.querySelector('[data-card-menu] [data-command="activate"], [data-card-menu] [data-command="summon"], [data-card-menu] [data-command="special"]');
     if(result=click(menu,'command'))return result;
     const tiles=[...document.querySelectorAll('[data-picker-card]')].filter(visible);
     if(tiles.length){
      const picked=new Set(tiles.filter(e=>e.classList.contains('md-tile-picked')).map(code));
      if(picked.size&&(result=click(exact('Confirmar')??exact('Concluir'),'confirm-picker-ready')))return result;
      const guided=tiles.filter(e=>e.hasAttribute('data-training-target')&&!e.classList.contains('md-tile-picked'));
      const next=guided.find(e=>!picked.has(code(e)));
      if(result=click(next,'picker'))return result;
      if(result=click(exact('Confirmar')??exact('Concluir'),'confirm-picker'))return result;
      if(result=click(guided[0],'picker-copy'))return result;
     }
     const chain=[...document.querySelectorAll('[data-chain-card]')].filter(visible);
     const chosen=chain.find(e=>e.classList.contains('md-tile-picked'));
     if(chosen&&(result=click(buttons.find(e=>/^Ativar/.test(e.innerText.trim())),'activate-trigger')))return result;
     if(result=click(chain.find(e=>e.hasAttribute('data-training-target')),'trigger'))return result;
     const pile=document.querySelector('[data-pile-modal]');
     if(pile){
      const chosen=pile.querySelector('[data-pile-card].md-tile-picked');
      if(chosen&&(result=click([...pile.querySelectorAll('button')].find(e=>!e.disabled&&/^(Invoca|Ativar)/.test(e.innerText.trim())),'pile-action')))return result;
      if(result=click(pile.querySelector('[data-pile-card][data-training-target]'),'pile-card'))return result;
     }
     const place=[...document.querySelectorAll('[data-zone^="0:"]')].find(e=>e.querySelector('.tf-slot-place'));
     if(result=click(place?.querySelector('[role="button"]'),'place'))return result;
     if(result=click(exact('Ataque (face p/ cima)')??exact('Defesa (face p/ cima)'),'position'))return result;
     const selection=document.querySelector('[data-selection-bar]');
     const slots=[...document.querySelectorAll('[data-zone]')];
     const slot=slots.find(e=>e.querySelector('[data-training-target]')&&e.querySelector('.tf-slot-active')&&!e.querySelector('.tf-slot-picked'));
     if(result=click(slot?.querySelector('[role="button"]'),'guided-field'))return result;
     if(selection&&(result=click(exact('Confirmar')??exact('Concluir'),'confirm-field')))return result;
     if(result=click(exact('Não responder')??exact('Não ativar'),'pass'))return result;
     if(!pile){
      const locations=targets.map(t=>t.location);
      const piles=[...document.querySelectorAll('[data-pile]')].filter(e=>e.dataset.pile.endsWith('-0')&&e.hasAttribute('data-actionable'));
      const desired=piles.find(e=>locations.includes({'extra':64,'grave':16,'banished':32}[e.dataset.pile.split('-')[0]]));
      if(result=click(desired,'open-pile'))return result;
     }
     return {did:null,stage,buttons:buttons.map(e=>e.innerText.trim()),text:document.body.innerText.slice(-1500)};
    `);
    if(result.done){complete=true;break;}
    if(result.did!=='wait')history.push(result);
    if(process.env.DEBUG_PRACTICE&&result.did!=='wait')console.log(lesson.id,result);
   }
   if(!complete){console.error(history.filter(item=>item.did).slice(-12),history.at(-1));writeFileSync(`${OUT}/failed-${lesson.id}.json`,JSON.stringify(history,null,2));writeFileSync(`${OUT}/failed-${lesson.id}.png`,Buffer.from((await page.screenshot()).data,'base64'));}
   assert.ok(complete,`exercício ${guide.id}/${lesson.id} concluído por cliques`);
   await page.waitForText('Você executou a sequência!');
   writeFileSync(`${OUT}/legendary-${lesson.id}.png`,Buffer.from((await page.screenshot()).data,'base64'));
   const next=guide.lessons[guide.lessons.findIndex(item=>item.id===lesson.id)+1];
   if(next)assert.equal(await page.evaluate(`return [...document.querySelectorAll('a')].find(a=>a.textContent.includes('Próximo exercício'))?.getAttribute('href');`),`/aprender/${guide.id}/treinar/${next.id}`);
   console.log(`✓ mesa real: ${guide.title} / ${lesson.title}`);
  }
  await page.setViewport(390,844,{mobile:true,touch:true});
  await page.goto(`${BASE}/aprender/${guide.id}/treinar/fog-blade-tem-duas-funcoes-em-turnos-diferentes`);
  await until(`return document.querySelector('[data-phase-button]')?.textContent.includes('Main1')&&!document.querySelector('[data-processing="1"]');`);
  assert.ok(await page.evaluate('return document.documentElement.scrollWidth<=innerWidth+1;'));
  assert.equal(await page.evaluate(`return document.querySelectorAll('[data-zone^="1:4:"] img').length;`),1,'mesa adversária preparada no app');
  assert.equal(await page.evaluate(`return document.querySelectorAll('[data-zone^="0:8:"] img').length;`),1,'Armadilha preparada no app');
  writeFileSync(`${OUT}/phantom-mobile.png`,Buffer.from((await page.screenshot()).data,'base64'));
  await page.goto(`${BASE}/aprender/${guide.id}`);
  await page.waitForText('O que você quer construir?');
  assert.equal(await page.evaluate(`return document.querySelector('progress[aria-label="Lições concluídas"]').value;`),selectedLessons.length);
 }
 await page.goto(`${BASE}/aprender`);
 await page.waitForText('Escolha por onde começar');
 writeFileSync(`${OUT}/legendary-library.png`,Buffer.from((await page.screenshot()).data,'base64'));
 for(const width of [390,320,768]){
  await page.setViewport(width,844,{mobile:width<768,touch:true});
  assert.ok(await page.evaluate('return document.documentElement.scrollWidth<=innerWidth+1;'),`biblioteca cabe em ${width}px`);
 }
 assert.deepEqual(page.errors,[],'sem erros de JavaScript');
 console.log(`✓ ${onlyLesson?'conclusão salva':'duas conclusões salvas, 13 exercícios acessíveis e mesa móvel preparada'} e biblioteca responsiva`);
}finally{await page.close();child.kill();}
