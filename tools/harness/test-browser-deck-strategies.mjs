/** Estratégias publicadas: busca, passos, leitura, retomada, isolamento e treino livre. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { launchChrome, openPage } from './browser.mjs';

const BASE = process.env.APP_URL ?? 'http://127.0.0.1:3000';
const OUT = '.cache/shots/learning';
const base = JSON.parse(readFileSync('src/data/deck-learning-base.json', 'utf8'));
const darkWorld = base.decks.find(deck => deck.id === 'tcg-sr13');
const [first, second] = darkWorld.lessons;
mkdirSync(OUT, { recursive: true });
const { child, port } = await launchChrome();
const page = await openPage(port);
async function until(expression, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(expression).catch(() => false)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Tempo esgotado: ${expression}`);
}
const click = async text => assert.ok(await page.clickText(text), `controle disponível: ${text}`);
const shot = async name => writeFileSync(`${OUT}/${name}.png`, Buffer.from((await page.screenshot()).data, 'base64'));
const lessonSelector = id => `[data-lesson=${JSON.stringify(id)}]`;
const currentStep = () => page.evaluate(`return Number(document.querySelector('[data-lesson] [role="group"][aria-label="Etapas da sequência"] button[aria-pressed="true"]')?.textContent) - 1;`);
const countCards = () => page.evaluate(`return document.querySelectorAll('[data-guide-card]').length;`);
async function search(query) {
  await page.evaluate(`const input=document.querySelector('input[type="search"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(query)});input.dispatchEvent(new Event('input',{bubbles:true}));return true;`);
}
async function nextStep(index) {
  await click('Próximo passo');
  await until(`return document.querySelector('[data-lesson] [aria-label="Etapas da sequência"] button[aria-pressed="true"]')?.textContent === '${index + 1}';`);
}
try {
  await page.setViewport(1440, 1100);
  await page.goto(`${BASE}/aprender`);
  await page.evaluate(`localStorage.setItem('yugioh-goat-profile-v1',JSON.stringify({id:'leitor-a',name:'Leitor A'}));return true;`);
  await page.goto(`${BASE}/aprender`);
  await page.waitForText('Escolha por onde começar');
  await until(`return document.querySelectorAll('[data-guide-card]').length === 12;`);
  await page.waitForText('92 decks');
  await click('Mostrar mais guias');
  await until(`return document.querySelectorAll('[data-guide-card]').length === 24;`);
  await search('xyz-nao-existe-42');
  await page.waitForText('Nenhum guia encontrado');
  await search('Machina Fortress');
  await until(`return Boolean(document.querySelector('[data-guide-card="tcg-sdmm"]'));`);
  await search('Fusão');
  await until(`return Boolean(document.querySelector('[data-guide-card="albaz-strike"]'));`);
  assert.ok(await countCards() <= 12, 'busca reinicia o limite de guias');
  await search('');
  await until(`return document.querySelectorAll('[data-guide-card]').length === 12;`);
  await until(`return [...document.images].every(image => {const box=image.getBoundingClientRect();return box.top>=innerHeight||box.bottom<=0||(image.complete&&image.naturalWidth>0);});`);
  await shot('expanded-library-desktop');
  console.log('✓ biblioteca de 92 guias, paginação, busca sem resultados, acentos e nomes de cartas');

  await page.goto(`${BASE}/aprender/${darkWorld.id}?licao=${first.id}`);
  await until(`return document.querySelector(${JSON.stringify(lessonSelector(first.id))})?.dataset.lessonKind === 'strategy';`);
  assert.equal(await currentStep(), 0);
  assert.equal(await page.evaluate(`return document.querySelector('progress[aria-label="Lições concluídas"]').value;`), 0);
  assert.equal(await page.evaluate(`return [...document.querySelectorAll('a')].some(a=>a.textContent.includes('Começar exercício'));`), false);
  assert.equal(await page.evaluate(`return [...document.querySelectorAll('button')].some(b=>b.textContent.includes('Concluir leitura'));`), false, 'abrir uma estratégia não a conclui');
  await nextStep(1);
  await page.goto(`${BASE}/aprender/${darkWorld.id}?licao=${first.id}`);
  await until(`return document.querySelector('[data-lesson] [aria-label="Etapas da sequência"] button[aria-pressed="true"]')?.textContent === '2';`);
  for (let index = 2; index < first.steps.length; index++) await nextStep(index);
  assert.equal(await page.evaluate(`return document.querySelector('progress[aria-label="Lições concluídas"]').value;`), 0, 'ler os passos não salva conclusão automática');
  await click('Concluir leitura');
  await page.waitForText('Leitura concluída');
  await until(`return document.querySelector('progress[aria-label="Lições concluídas"]').value === 1;`);
  const savedSteps = await page.evaluate(`return JSON.parse(localStorage.getItem('yugioh-goat-learning-v1:leitor-a:tcg-sr13:1')).steps;`);
  assert.equal(savedSteps[first.id], first.steps.length - 1, 'concluir uma leitura preserva as etapas salvas');
  await click('Próxima lição');
  await until(`return document.querySelector('[data-lesson]')?.dataset.lesson === ${JSON.stringify(second.id)};`);
  await nextStep(1);
  await page.goto(`${BASE}/aprender`);
  await search('Mundo Negro');
  await until(`return Boolean(document.querySelector('[data-guide-card="tcg-sr13"]'));`);
  await page.evaluate(`document.querySelector('[data-guide-card="tcg-sr13"] a').click(); return true;`);
  await until(`return document.querySelector('[data-lesson]')?.dataset.lesson === ${JSON.stringify(second.id)};`);
  assert.equal(await currentStep(), 1, 'retomada pela biblioteca conserva a etapa');
  assert.equal(await page.evaluate(`return document.querySelector('progress[aria-label="Lições concluídas"]').value;`), 1);
  await shot('strategy-reader-desktop');
  console.log('✓ leitura explícita, próxima lição, progresso e retomada da etapa');

  await click('Cartas-chave');
  await until(`return Boolean(document.querySelector('button[aria-label^="Ler "]:not(:disabled)'));`);
  await page.evaluate(`document.querySelector('button[aria-label^="Ler "]:not(:disabled)').click();return true;`);
  await until(`return Boolean(document.querySelector('[data-card-reader]'));`);
  await click('Fechar ✕');
  await click('Fontes');
  await page.waitForText('Fontes e revisão');
  assert.ok(await page.evaluate(`return document.querySelectorAll('a[href*="db.yugioh-card.com"]').length >= 5;`));
  await page.evaluate(`localStorage.setItem('yugioh-goat-profile-v1',JSON.stringify({id:'leitor-b',name:'Leitor B'}));return true;`);
  await page.goto(`${BASE}/aprender/${darkWorld.id}?licao=${first.id}`);
  await until(`return Boolean(document.querySelector('[data-lesson]'));`);
  assert.equal(await currentStep(), 0);
  assert.equal(await page.evaluate(`return document.querySelector('progress[aria-label="Lições concluídas"]').value;`), 0, 'progresso e etapa separados por jogador');
  console.log('✓ consulta de cartas, fontes e isolamento por jogador');

  for (const width of [320, 390, 768]) {
    await page.setViewport(width, 844, { mobile: width < 768, touch: true });
    assert.ok(await page.evaluate(`return document.documentElement.scrollWidth <= innerWidth + 1;`), `estratégia cabe em ${width}px`);
    assert.ok(await page.evaluate(`const nav=document.querySelector('[data-mobile-lesson-nav]').getBoundingClientRect();const steps=[...document.querySelectorAll('[aria-label="Etapas da sequência"] button')];return nav.top>0&&nav.bottom<=innerHeight+1&&steps.every(button=>{const box=button.getBoundingClientRect();return box.width>=44&&box.height>=44;});`), `troca de lições acessível e etapas fáceis de tocar em ${width}px`);
  }
  await page.setViewport(390, 844, { mobile: true, touch: true });
  await page.evaluate(`window.scrollTo(0,document.documentElement.scrollHeight);return true;`);
  await page.evaluate(`const select=document.querySelector('#mobile-guide-lesson');select.value=${JSON.stringify(second.id)};select.dispatchEvent(new Event('change',{bubbles:true}));return true;`);
  await until(`return document.querySelector('[data-lesson]')?.dataset.lesson===${JSON.stringify(second.id)}&&document.activeElement?.id==='lesson-title';`);
  assert.equal(await page.evaluate(`return new URL(location.href).searchParams.get('licao');`), second.id, 'troca mantém o endereço da lição atual');
  assert.ok(await page.evaluate(`const title=document.querySelector('#lesson-title').getBoundingClientRect();const header=document.querySelector('.site-header').getBoundingClientRect();const nav=document.querySelector('[data-mobile-lesson-nav]').getBoundingClientRect();return title.top>=header.bottom&&title.bottom<nav.top;`), 'trocar de lição traz o título para a área livre da tela');
  const target=await page.evaluate(`const button=[...document.querySelectorAll('[data-lesson] button')].find(button=>button.textContent.includes('Próximo passo'));button.scrollIntoView({block:'center'});const box=button.getBoundingClientRect();return {x:box.left+box.width/2,y:box.top+box.height/2};`);
  await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[target]});
  await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await until(`return document.querySelector('[data-lesson] [aria-label="Etapas da sequência"] button[aria-pressed="true"]')?.textContent==='2';`);
  const currentUrl=await page.evaluate(`return location.href;`);
  await page.goto(currentUrl);
  await until(`return document.querySelector('[data-lesson]')?.dataset.lesson===${JSON.stringify(second.id)}&&document.querySelector('[data-lesson] [aria-label="Etapas da sequência"] button[aria-pressed="true"]')?.textContent==='2';`);
  await page.evaluate(`document.querySelector('[aria-label="Etapas da sequência"]').scrollIntoView({block:'center'});return true;`);
  await shot('strategy-reader-mobile');
  console.log('✓ troca de lição sem rolar a página, avanço por toque e retomada após recarregar no celular');
  await page.goto(`${BASE}/aprender`);
  await page.waitForText('Escolha por onde começar');
  await search('Crônicas');
  await until(`return Boolean(document.querySelector('[data-guide-card="tcg-ch01"]'));`);
  assert.ok(await page.evaluate(`return document.documentElement.scrollWidth <= innerWidth + 1;`), 'títulos longos cabem na biblioteca');
  assert.ok(await page.evaluate(`return document.querySelector('[data-guide-card]').getBoundingClientRect().top<innerHeight-80;`), 'a abertura compacta deixa o primeiro deck visível no celular');

  await page.goto(`${BASE}/aprender/${darkWorld.id}/treinar/${first.id}`);
  await page.waitForText('404');
  const albaz = base.decks.find(deck => deck.presetId === 'tcg-sdaz');
  const newLesson = albaz.lessons.find(lesson => !lesson.origin);
  await page.goto(`${BASE}/aprender/albaz-strike?licao=${newLesson.id}`);
  await until(`return document.querySelector('[data-lesson]')?.dataset.lessonKind === 'strategy';`);
  assert.equal(await page.evaluate(`return document.querySelectorAll('aside li').length;`), 8);
  await page.goto(`${BASE}/aprender/albaz-strike?licao=primeira-fusao`);
  await until(`return document.querySelector('[data-lesson]')?.dataset.lessonKind === 'practice';`);
  await page.waitForText('Começar exercício na mesa');
  console.log('✓ estratégias no celular, oito lições nos guias antigos e rota de prática protegida');

  await page.goto(`${BASE}/aprender/${darkWorld.id}?licao=${first.id}`);
  await until(`return document.querySelector('[data-lesson]')?.dataset.lessonKind === 'strategy';`);
  await page.evaluate(`window.__strategyOriginalSetItem=Storage.prototype.setItem; Storage.prototype.setItem=function(key,value){if(key.startsWith('yugioh-goat-learning-v1:'))throw new DOMException('Storage blocked','QuotaExceededError');return window.__strategyOriginalSetItem.call(this,key,value);};return true;`);
  await nextStep(1);
  await page.waitForText('O navegador não permitiu salvar seu progresso');
  for (let index = 2; index < first.steps.length; index++) await nextStep(index);
  await click('Concluir leitura');
  await page.waitForText('Leitura concluída');
  assert.equal(await page.evaluate(`return document.querySelector('progress[aria-label="Lições concluídas"]').value;`), 1, 'armazenamento bloqueado mantém o estudo na sessão');
  await page.evaluate(`Storage.prototype.setItem=window.__strategyOriginalSetItem;delete window.__strategyOriginalSetItem;return true;`);
  console.log('✓ falha de armazenamento é informada e não bloqueia avanço e conclusão de leitura');

  await page.setViewport(1440, 1000);
  await page.goto(`${BASE}/aprender/${darkWorld.id}`);
  await page.waitForText('O que você quer construir?');
  await click('Praticar contra o bot');
  await until(`return location.pathname === '/duel/play';`);
  const setup = await page.evaluate(`return JSON.parse(sessionStorage.getItem('yugioh-goat-duel-setup-v1'));`);
  assert.deepEqual(setup.playerDeck, darkWorld.deckSnapshot);
  assert.deepEqual(setup.opponentDeck, darkWorld.deckSnapshot);
  assert.equal(setup.format, 'tcg');
  assert.equal(setup.scenario, undefined);
  await until(`return Boolean(document.querySelector('[data-phase-button]'));`, 60000);
  assert.equal(await page.evaluate(`return document.querySelectorAll('[data-training-highlight]').length;`), 0);
  assert.deepEqual(page.errors, [], 'sem exceções de JavaScript');
  console.log('✓ novo deck inicia duelo livre com a lista exata e sem orientação inventada');
} finally {
  await page.close();
  child.kill();
}
