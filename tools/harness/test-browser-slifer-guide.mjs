/** Guia Slifer no leitor real: raciocínio, cartas, decisões, fontes e celular. */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {launchChrome,openPage} from './browser.mjs';
const base=process.env.APP_URL??'http://localhost:3000';
const deck=JSON.parse(readFileSync('src/data/deck-learning-base.json','utf8')).decks.find(d=>d.id==='tcg-egs1');
const {child,port}=await launchChrome(),page=await openPage(port);
const out='.cache/shots/learning';mkdirSync(out,{recursive:true});
async function until(js){const deadline=Date.now()+30000;while(Date.now()<deadline){if(await page.evaluate(js).catch(()=>false))return;await new Promise(r=>setTimeout(r,100));}throw Error(js);}
async function click(label){assert.ok(await page.clickText(label),label);}
try{
  await page.goto(`${base}/aprender/tcg-egs1`);
  await page.evaluate(`localStorage.setItem('yugioh-goat-profile-v1',JSON.stringify({id:'slifer-guide-review',name:'Revisão Slifer'}));return true;`);
  await page.goto(`${base}/aprender/tcg-egs1`);
  await until(`return document.querySelector('progress[aria-label="Lições concluídas"]')?.max===13;`);
  await page.waitForText('Intermediário');
  await page.waitForText('Ahrima');
  for(const lesson of deck.lessons){
    await page.goto(`${base}/aprender/tcg-egs1?licao=${lesson.id}`);
    await until(`return document.querySelector('[data-lesson]')?.dataset.lesson===${JSON.stringify(lesson.id)};`);
    await page.waitForText('Por que fazer isso?');
    assert.ok(await page.evaluate(`return document.querySelector('[data-lesson]').textContent.includes(${JSON.stringify(lesson.steps[0].why)});`));
    assert.ok(await page.evaluate(`return document.documentElement.scrollWidth<=innerWidth+1;`));
  }
  await page.goto(`${base}/aprender/tcg-egs1?licao=ahrima-tributa-o-adversario`);
  await until(`return document.querySelector('[data-lesson]')?.dataset.lesson==='ahrima-tributa-o-adversario';`);
  await page.waitForText('Por que fazer isso?');
  await click('Próximo passo');await page.waitForText('Escolha entre compra e acesso conhecido');
  await until(`return Boolean(document.querySelector('[data-lesson] button[aria-label^="Ler "]:not(:disabled)'));`);
  await page.evaluate(`document.querySelector('[data-lesson] button[aria-label^="Ler "]:not(:disabled)').click();return true;`);
  await until(`return Boolean(document.querySelector('[data-card-reader]'));`);await click('Fechar ✕');
  await page.evaluate(`const lesson=document.querySelector('[data-lesson]');window.scrollTo(0,lesson.getBoundingClientRect().top+scrollY-95);return true;`);
  writeFileSync(`${out}/slifer-ahrima-desktop.png`,Buffer.from((await page.screenshot()).data,'base64'));
  await click('Decisões');await until(`return document.querySelectorAll('[data-guide-decisions] article').length===8;`);
  await page.evaluate(`document.querySelector('[data-guide-decisions] article button').click();return true;`);
  await until(`return Boolean(document.querySelector('[data-guide-decisions] [role="status"]'));`);
  await click('Cartas-chave');
  await until(`return document.querySelector('#guide-cards')?.parentElement.textContent.includes('Acesso ao Campo e remoção por custo');`);
  assert.equal(await page.evaluate(`return document.querySelectorAll('button[aria-label^="Ler "]').length;`),38);
  await click('Fontes');await page.waitForText('27/10/2026');
  assert.ok(await page.evaluate(`return document.querySelectorAll('a[href*="db.yugioh-card.com"]').length>=38;`));
  await page.setViewport(390,844,{mobile:true,touch:true});
  await page.goto(`${base}/aprender/tcg-egs1?licao=duke-vishuda-e-os-bloqueios`);
  await until(`return document.querySelector('[data-lesson]')?.dataset.lesson==='duke-vishuda-e-os-bloqueios';`);
  await page.waitForText('Por que fazer isso?');
  assert.ok(await page.evaluate(`return document.documentElement.scrollWidth<=innerWidth+1;`));
  await page.evaluate(`const lesson=document.querySelector('[data-lesson]');window.scrollTo(0,lesson.getBoundingClientRect().top+scrollY-95);return true;`);
  writeFileSync(`${out}/slifer-duke-mobile.png`,Buffer.from((await page.screenshot()).data,'base64'));
  assert.equal(page.errors.length,0,page.errors.join('\n'));
  console.log('✓ Chrome: 13 lições com raciocínio, 38 cartas, 8 decisões, fontes e leitor mobile sem overflow');
}finally{await page.close();child.kill();}
