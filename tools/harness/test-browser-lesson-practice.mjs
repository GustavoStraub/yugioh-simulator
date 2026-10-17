/** Executa as três lições clicando na mesa real e confere conclusão e reinício. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchChrome, openPage } from "./browser.mjs";

const guide = JSON.parse(readFileSync("src/data/deck-guides/albaz-strike.json", "utf8"));
const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const OUT = join(process.cwd(), ".cache/shots/learning");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const { child, port } = await launchChrome();
const page = await openPage(port);
async function until(expression, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await page.evaluate(expression).catch(() => false)) return;
    await sleep(100);
  }
  throw new Error(`Timeout: ${expression}`);
}
const shot = async (name) => writeFileSync(join(OUT, `${name}.png`), Buffer.from((await page.screenshot()).data, "base64"));

try {
  await page.setViewport(1440, 1000);
  await page.goto(`${BASE}/aprender`);
  await page.evaluate(String.raw`localStorage.setItem('yugioh-goat-profile-v1', JSON.stringify({id:'practice-browser',name:'Aprendiz'})); localStorage.setItem('yugioh-goat-tips-v1',JSON.stringify({off:true,seen:[]})); return true;`);
  for (const lesson of guide.lessons) {
    if (lesson === guide.lessons[0]) await page.goto(`${BASE}/aprender/${guide.id}/treinar/${lesson.id}`);
    else {
      assert.ok(await page.clickText("Próximo exercício"));
      await until(`return document.querySelector('[data-practice-lesson]')?.dataset.practiceLesson === '${lesson.id}';`);
    }
    await until(`return document.querySelector('[data-phase-button]')?.textContent.includes('Main1') && !document.querySelector('[data-processing="1"]');`);
    const initialHand = await page.evaluate(String.raw`return [...document.querySelectorAll('[data-zone^="0:2:"] img')].map(img => Number(img.src.split('/').pop().match(/^(\d+)\./)?.[1])).sort((a,b)=>a-b);`);
    assert.deepEqual(initialHand, [...lesson.startingHand].sort((a, b) => a - b), "mão inicial exata, sem cartas extras");
    const initialTargets = await page.evaluate(String.raw`return [...document.querySelectorAll('[data-zone^="0:2:"] [data-training-target] img')].map(img => Number(img.src.split('/').pop().match(/^(\d+)\./)?.[1]));`);
    assert.deepEqual(initialTargets, [lesson.id === "encontrar-inicio" ? 45484331 : 44362883], "somente a primeira carta da lição recebe GUIA");
    if (lesson === guide.lessons[0]) {
      await page.send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      assert.equal(await page.evaluate(`return getComputedStyle(document.querySelector('[data-training-highlight]')).animationName;`), 'none');
      await page.send('Emulation.setEmulatedMedia', {features:[]});
      await shot("practice-desktop");
      await page.setViewport(844, 390, { mobile: true, touch: true });
      await sleep(300);
      assert.ok(await page.evaluate(String.raw`const c=document.querySelector('[data-training-panel]').getBoundingClientRect();return c.top>=0 && c.bottom < innerHeight/2;`), "orientação cabe na horizontal");
      assert.ok(await page.evaluate(`return [...document.querySelectorAll('[data-practice-lesson] button,[data-practice-lesson] a')].every(button=>button.getBoundingClientRect().height>=44);`), "controles do treino têm área de toque confortável na horizontal");
      await shot("practice-mobile");
      await page.setViewport(390,844,{mobile:true,touch:true});
      await sleep(300);
      assert.ok(await page.evaluate(`return document.documentElement.scrollWidth<=innerWidth+1&&[...document.querySelectorAll('[data-practice-lesson] button,[data-practice-lesson] a')].every(button=>button.getBoundingClientRect().height>=44);`), "treino cabe no retrato com controles de toque grandes");
      const hintToggle=await page.evaluate(`const button=document.querySelector('[data-practice-lesson] button[aria-expanded]');const box=button.getBoundingClientRect();return {x:box.left+box.width/2,y:box.top+box.height/2};`);
      await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[hintToggle]});
      await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await until(`return document.querySelector('[data-practice-lesson] button[aria-expanded]')?.getAttribute('aria-expanded')==='false';`);
      assert.ok(await page.clickText('Mostrar dica'));
      await until(`return document.querySelector('[data-practice-lesson] button[aria-expanded]')?.getAttribute('aria-expanded')==='true';`);
      await shot('practice-mobile-portrait');
      await page.setViewport(1440, 1000);
      await page.clickText("Recomeçar");
      await until(`return document.querySelector('[data-phase-button]')?.textContent.includes('Main1') && !document.querySelector('[data-processing="1"]');`);
      assert.equal(await page.evaluate(String.raw`return document.querySelector('[data-practice-lesson]').dataset.practiceStage;`), "0", "reinício limpa a tentativa");
    }
    const firstFusion = lesson.id === "rota-albion" ? 87746184 : 70534340;
    let completed = false;
    let restartedAfterFusion = false;
    for (let turn = 0; turn < 180; turn += 1) {
      await sleep(150);
      const state = await page.evaluate(String.raw`
        const visible=el=>el && el.offsetParent!==null;
        const code=img=>Number((img?.src ?? '').split('/').pop().match(/^(\d+)\./)?.[1]);
        return {
          complete:document.querySelector('[data-practice-lesson]')?.dataset.practiceCompleted==='true',
          processing:Boolean(document.querySelector('[data-processing="1"]')),
          stage:Number(document.querySelector('[data-practice-lesson]')?.dataset.practiceStage),
          picker:[...document.querySelectorAll('[data-picker-card]')].filter(visible).map(el=>({index:el.dataset.pickerCard,code:code(el.querySelector('img')),picked:el.classList.contains('md-tile-picked'),guided:el.hasAttribute('data-training-target'),place:el.querySelector('.md-tile-place')?.innerText})),
          monsters:[...document.querySelectorAll('[data-zone^="0:4:"] img')].map(code),
          buttons:[...document.querySelectorAll('button')].filter(b=>visible(b)&&!b.disabled).map(b=>b.innerText.trim()).filter(Boolean)
        };
      `);
      if (state.complete) { completed = true; break; }
      if (lesson === guide.lessons[0] && state.stage >= 2 && !restartedAfterFusion) {
        restartedAfterFusion = true;
        await page.clickText("Recomeçar");
        await until(`return document.querySelector('[data-practice-lesson]')?.dataset.practiceStage==='0' && document.querySelectorAll('[data-zone^="0:2:"] img').length===5;`);
        assert.equal(await page.evaluate(`return document.querySelectorAll('[data-zone^="0:4:"] img').length;`), 0, "recomeçar remove a Fusão e restaura a mão");
        continue;
      }
      if (state.processing) continue;
      if (process.env.DEBUG_PRACTICE) console.log(lesson.id, state.stage, state.picker, state.buttons);
      if (state.picker.length) {
        let wanted;
        if (state.picker.every((item) => item.place?.includes("Extra"))) wanted = [state.monsters.includes(firstFusion) ? 44146295 : firstFusion];
        else if (lesson.id === "encontrar-inicio" && state.stage < 2) wanted = state.picker.some((item) => item.code === 44362883) ? [44362883] : [59919307];
        else if (state.picker.every((item) => /Mão/.test(item.place))) wanted = [10813327];
        else wanted = state.monsters.includes(firstFusion) ? [68468459, firstFusion] : [68468459, lesson.id === "rota-albion" ? 97268402 : 19096726];
        const expectedTargets = state.picker.filter((item) => wanted.includes(item.code) && !item.picked).map((item) => item.code).sort();
        assert.deepEqual(state.picker.filter((item) => item.guided).map((item) => item.code).sort(), expectedTargets, "GUIA acompanha os materiais e não marca cartas já selecionadas");
        if (lesson === guide.lessons[0] && turn < 20 && expectedTargets.length) await shot(state.picker.every((item) => item.place?.includes("Extra")) ? "guide-highlight-extra" : "guide-highlight-materials");
        const candidate = state.picker.find((item) => wanted.includes(item.code) && !item.picked);
        if (candidate) {
          await page.evaluate(String.raw`document.querySelector('[data-picker-card="${candidate.index}"]').click();return true;`);
          continue;
        }
        if (state.buttons.includes("Confirmar")) { await page.clickText("Confirmar"); continue; }
        if (state.buttons.includes("Concluir")) { await page.clickText("Concluir"); continue; }
      }
      const did = await page.evaluate(String.raw`
        const visible=el=>el && el.offsetParent!==null;
        const code=img=>Number((img?.src ?? '').split('/').pop().match(/^(\d+)\./)?.[1]);
        const click=el=>{if(!el)return false;el.click();return true;};
        const buttons=[...document.querySelectorAll('button')].filter(b=>visible(b)&&!b.disabled);
        const exact=text=>buttons.find(b=>b.innerText.trim()===text);
        if(click(exact('Não responder')))return 'pass';
        if(click(exact('Sim')))return 'yes';
        if(click(exact('Ataque (face p/ cima)')))return 'position';
        const menu=document.querySelector('[data-card-menu] [data-command="activate"], [data-card-menu] [data-command="summon"]');
        if(click(menu))return 'command';
        const place=[...document.querySelectorAll('[data-zone^="0:"]')].find(el=>el.querySelector('.tf-slot-place'));
        if(click(place?.querySelector('[role="button"]')))return 'place';
        const selection=document.querySelector('[data-selection-bar]');
        if(selection){
          const slot=[...document.querySelectorAll('[data-zone^="0:"]')].find(el=>code(el.querySelector('img'))===${lesson.id === 'encontrar-inicio' && state.stage === 1 ? 59919307 : 10813327} && el.querySelector('.tf-slot-active')&&!el.querySelector('.tf-slot-picked'));
          if(click(slot?.querySelector('[role="button"]')))return 'discard';
          if(click(exact('Confirmar')))return 'confirm';
          if(click(exact('Concluir')))return 'finish';
        }
        const trigger=[...document.querySelectorAll('[data-chain-card]')].find(el=>[${firstFusion},45484331].includes(code(el.querySelector('img'))));
        if(trigger){ if(!trigger.classList.contains('md-tile-picked')){trigger.click();return 'trigger';} if(click(buttons.find(b=>b.innerText.startsWith('Ativar'))))return 'trigger-activate'; }
        const hand=[...document.querySelectorAll('[data-zone^="0:2:"]')].find(el=>code(el.querySelector('img'))===${lesson.id === "encontrar-inicio" ? 45484331 : 44362883} && el.querySelector('.tf-slot-active'))
          ?? [...document.querySelectorAll('[data-zone^="0:2:"]')].find(el=>code(el.querySelector('img'))===44362883 && el.querySelector('.tf-slot-active'));
        if(click(hand?.querySelector('[role="button"]')))return 'hand';
        return null;
      `);
      if (!did && state.buttons.includes("Confirmar")) await page.clickText("Confirmar");
    }
    if (!completed) {
      await shot(`practice-failed-${lesson.id}`);
      console.error(await page.evaluate(String.raw`return document.body.innerText;`));
    }
    assert.ok(completed, `objetivo executado: ${lesson.id}`);
    await page.waitForText("Você executou a sequência!");
    await shot(`practice-completed-${lesson.id}`);
    console.log(`✓ cliques na mesa: ${lesson.title}`);
  }
  await page.goto(`${BASE}/aprender/${guide.id}`);
  await page.waitForText("O que você quer construir?");
  assert.equal(await page.evaluate(String.raw`return document.querySelector('progress[aria-label="Lições concluídas"]').value;`), 3);
  assert.equal(page.errors.length, 0, page.errors.join("\n"));
  console.log("✓ três objetivos concluídos, progresso salvo e reinício com mão fixa");
} finally {
  await page.close();
  child.kill();
}
