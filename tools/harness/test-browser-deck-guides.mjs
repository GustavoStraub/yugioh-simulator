/** A trilha editorial na tela: navegação, cartas, revisão, progresso e duelo. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { launchChrome, openPage } from "./browser.mjs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const OUT = join(process.cwd(), ".cache/shots/learning");
mkdirSync(OUT, { recursive: true });

async function until(page, expression, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await page.evaluate(expression).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Tempo esgotado: ${expression}`);
}

const { child, port } = await launchChrome();
const page = await openPage(port);
const click = async (text) => {
  assert.ok(await page.clickText(text), `botão/link disponível: ${text}`);
};
const shot = async (name) => {
  const { data } = await page.screenshot();
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
};

try {
  await page.setViewport(1440, 1100);
  await page.goto(`${BASE}/aprender`);
  await page.waitForText("Como você quer ser chamado?");
  await page.evaluate(`
    localStorage.setItem('yugioh-goat-profile-v1', JSON.stringify({ id: 'guide-test-a', name: 'Aprendiz A' }));
    return true;
  `);
  await page.goto(`${BASE}/aprender`);
  await page.waitForText("Conheça o deck.");
  await until(page, `return [...document.images].every(image => { const box = image.getBoundingClientRect(); return box.top >= innerHeight || box.bottom <= 0 || (image.complete && image.naturalWidth > 0); });`);
  assert.equal(await page.evaluate(`return document.querySelector('nav a[aria-current="page"]')?.textContent.includes('Aprender');`), true);
  await shot("library-desktop");
  await page.evaluate(`const filter=document.querySelectorAll('[data-learning-library] select')[1];filter.value='decisions';filter.dispatchEvent(new Event('change',{bubbles:true}));return true;`);
  await until(page, `return document.querySelectorAll('[data-guide-card]').length===8;`);
  await page.evaluate(`const filter=document.querySelectorAll('[data-learning-library] select')[1];filter.value='practice';filter.dispatchEvent(new Event('change',{bubbles:true}));return true;`);
  await until(page, `return document.querySelectorAll('[data-guide-card]').length===4;`);
  await page.evaluate(`const filter=document.querySelectorAll('[data-learning-library] select')[1];filter.value='all';filter.dispatchEvent(new Event('change',{bubbles:true}));return true;`);
  await page.evaluate(`const input = document.querySelector('input[type="search"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'xyz-nao-existe'); input.dispatchEvent(new Event('input', {bubbles:true})); return true;`);
  await page.waitForText("Nenhum guia encontrado.");
  await page.evaluate(`const input = document.querySelector('input[type="search"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ''); input.dispatchEvent(new Event('input', {bubbles:true})); return true;`);
  await page.evaluate(`document.querySelector('a[href="/aprender/albaz-strike"]').click(); return true;`);
  await page.waitForText("O que você quer construir?");
  await shot("guide-desktop");
  await click("Decisões");
  await page.waitForText("Qual jogada você escolheria?");
  await shot("decisions-desktop");
  await page.evaluate(`document.querySelectorAll('[data-decision="kitt-encontra-a-fusao"] [role="group"] button')[1].click(); return true;`);
  assert.equal(await page.evaluate(`return document.querySelector('[data-decision="kitt-encontra-a-fusao"] [data-result]')?.dataset.result;`), "review");
  await page.evaluate(`document.querySelectorAll('[data-decision="kitt-encontra-a-fusao"] [role="group"] button')[0].click(); return true;`);
  assert.equal(await page.evaluate(`return document.querySelector('[data-decision="kitt-encontra-a-fusao"] [data-result]')?.dataset.result;`), "correct");
  await page.evaluate(`document.querySelectorAll('[data-decision="kitt-encontra-a-fusao"] button')[2].click(); return true;`);
  assert.equal(await page.evaluate(`return document.querySelector('[data-lesson]')?.dataset.lesson;`), "encontrar-inicio");
  await click("Cartas-chave");
  await until(page, `return Boolean(document.querySelector('button[aria-label^="Ler Fusão"]:not(:disabled)'));`);
  await page.evaluate(`document.querySelector('button[aria-label^="Ler Fusão"]').click(); return true;`);
  await until(page, `return Boolean(document.querySelector('[data-card-reader]'));`);
  await click("Fechar ✕");
  await click("Jogadas e lições");
  await page.waitForText("Começar exercício na mesa");
  await click("Uma alternativa sem o descarte");
  await page.waitForText("Use Albion como ponte");
  assert.equal(await page.evaluate(`return document.querySelectorAll('input[type="radio"]').length;`), 0);
  await page.goto(`${BASE}/aprender`);
  await page.waitForText("Continuar aprendendo");
  await click("Continuar aprendendo");
  await page.waitForText("Começar exercício na mesa");
  assert.equal(await page.evaluate(`return document.querySelector('progress[aria-label="Lições concluídas"]').value;`), 0, "ler a lição não conclui o exercício");
  console.log("✓ biblioteca, busca, leitura, exercício e retomada");

  await page.setViewport(390, 844, { mobile: true, touch: true });
  await page.evaluate(`window.scrollTo(0, 0); return true;`);
  await shot("lesson-mobile");
  await click("Decisões");
  await shot("decisions-mobile");
  for (const width of [390, 320, 768]) {
    await page.setViewport(width, 844, { mobile: width < 768, touch: true });
    assert.ok(await page.evaluate(`return document.documentElement.scrollWidth <= innerWidth + 1;`), `guia sem overflow em ${width}px`);
  }
  await click("Fontes");
  await page.waitForText("Fontes e revisão");
  assert.ok(await page.evaluate(`return document.querySelectorAll('a[href*="db.yugioh-card.com"]').length >= 7;`));
  await page.goto(`${BASE}/aprender/herois-lendarios-destiny-hero`);
  await page.waitForText("Funda, transforme e aproveite seus materiais.");
  await click("Cartas-chave");
  await until(page, `return document.querySelector('[aria-labelledby="guide-cards"]')?.textContent.includes('Estende a mão');`);
  await click("Decisões");
  await page.waitForText("Broca-negra transforma Malicioso em presença");
  assert.equal(await page.evaluate(`return document.querySelectorAll('[data-guide-decisions] [data-decision]').length;`), 6);
  assert.ok(await page.evaluate(`return Boolean(document.querySelector('[data-decision="plasma-conta-os-tres-tributos"]'));`));
  await page.goto(`${BASE}/aprender/herois-lendarios-cavaleiros-fantasmas`);
  await page.waitForText("O material de hoje é o recurso da próxima jogada.");
  await click("Decisões");
  await page.waitForText("Quando Botas já está na mão, busque o primeiro Cavaleiro");
  assert.equal(await page.evaluate(`return document.querySelectorAll('[data-guide-decisions] [data-decision]').length;`), 6);
  assert.ok(await page.evaluate(`return Boolean(document.querySelector('[data-decision="junk-forward-com-botas"]'));`));
  await page.goto(`${BASE}/aprender/guia-inexistente`);
  await page.waitForText("404");
  console.log("✓ celular, fontes e guia inexistente");

  await page.goto(`${BASE}/aprender/albaz-strike`);
  await page.waitForText("O que você quer construir?");
  await page.evaluate(`localStorage.setItem('yugioh-goat-profile-v1', JSON.stringify({id:'guide-test-b',name:'Aprendiz B'})); return true;`);
  await page.goto(`${BASE}/aprender/albaz-strike`);
  await page.waitForText("O que você quer construir?");
  assert.equal(await page.evaluate(`return document.querySelector('progress[aria-label="Lições concluídas"]').value;`), 0, "progresso separado por jogador");
  await page.setViewport(1440, 900);
  await click("Praticar contra o bot");
  await until(page, `return location.pathname === '/duel/play';`);
  const setup = await page.evaluate(`return JSON.parse(sessionStorage.getItem('yugioh-goat-duel-setup-v1'));`);
  assert.equal(setup.format, "tcg");
  assert.equal(setup.playerDeck.main.length, 40);
  assert.equal(setup.playerDeck.extra.length, 6);
  assert.deepEqual(setup.playerDeck, setup.opponentDeck);
  assert.equal(setup.scenario, undefined, "duelo livre não injeta cartas");
  await until(page, `return Boolean(document.querySelector('[data-phase-button]'));`, 60000);
  assert.equal(await page.evaluate(`return document.querySelectorAll("[data-training-highlight]").length;`), 0, "duelo livre não recebe destaques de aprendizado");
  const appErrors = page.errors.filter((error) =>
    !(error.includes("flushComponentPerformance") && error.includes("cannot have a negative time stamp")));
  assert.equal(appErrors.length, 0, appErrors.join("\n"));
  console.log("✓ progresso por jogador e duelo TCG com a lista oficial");
  console.log(`Capturas: ${OUT}`);
} finally {
  await page.close();
  child.kill();
}
