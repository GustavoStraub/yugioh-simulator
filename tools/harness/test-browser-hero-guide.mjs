import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {launchChrome,openPage} from './browser.mjs';
const guide=JSON.parse(readFileSync('src/data/deck-guides/herois-lendarios-destiny-hero.json','utf8'));
const base=process.env.APP_URL??'http://localhost:3000';
const {child,port}=await launchChrome(),page=await openPage(port);
async function until(js){const end=Date.now()+30000;while(Date.now()<end){if(await page.evaluate(js).catch(()=>false))return;await new Promise(r=>setTimeout(r,100));}throw Error(js);}
try{
 await page.goto(`${base}/aprender/${guide.id}`);
 await page.evaluate(`localStorage.setItem('yugioh-goat-profile-v1',JSON.stringify({id:'hero-review',name:'HERO'}));return true;`);
 for(const lesson of guide.lessons){
  await page.goto(`${base}/aprender/${guide.id}?licao=${lesson.id}`);
  await until(`return document.querySelector('[data-lesson]')?.dataset.lesson===${JSON.stringify(lesson.id)};`);
  assert.equal(await page.evaluate(`return document.querySelector('[data-lesson]').dataset.lessonKind;`),'practice');
  await page.evaluate(`for(const el of document.querySelectorAll('[data-lesson] details'))el.open=true;return true;`);
  await page.waitForText('Por que fazer isso?');
 }
 for(const width of [1440,390]){
  await page.setViewport(width,844,{mobile:width===390,touch:width===390});
  await page.goto(`${base}/aprender/${guide.id}/treinar/perigoso-prepara-malicioso`);
  await until(`return document.querySelector('[data-phase-button]')?.textContent.includes('Main1')&&!document.querySelector('[data-processing="1"]');`);
  assert.ok(await page.evaluate('return document.documentElement.scrollWidth<=innerWidth+1;'));
  assert.equal(await page.evaluate('return document.querySelector("[data-practice-lesson]").dataset.practiceStage;'),'0');
  mkdirSync('.cache/shots/learning',{recursive:true});writeFileSync(`.cache/shots/learning/hero-${width}.png`,Buffer.from((await page.screenshot()).data,'base64'));
 }
 assert.deepEqual(page.errors,[]);console.log('✓ Chrome: 12 exercícios HERO acessíveis, mesa desktop e celular sem overflow');
}finally{await page.close();child.kill();}
