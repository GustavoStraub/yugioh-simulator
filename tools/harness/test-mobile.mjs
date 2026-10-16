/** Regressões de UX mobile em Chrome real, com viewport e eventos de toque. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchChrome, openPage } from "./browser.mjs";
import { REPO } from "./env.mjs";
import { OcgLocation } from "@n1xx1/ocgcore-wasm";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const OUT = join(REPO, ".cache/shots/mobile");
const profile = `harness-mobile-${process.pid}`;
const preset = JSON.parse(readFileSync(join(REPO, "src/data/preset-decks.json"), "utf8"))[0];
const counts = new Map();
for (const code of preset.main) counts.set(code, (counts.get(code) ?? 0) + 1);
const deck = {
  id: "mobile-fixture", name: "Deck mobile", format: "goat", extra: [], side: [],
  main: [...counts].map(([passcode, quantity]) => ({ passcode, quantity })),
  updatedAt: new Date().toISOString(),
};
const sizes = [[320,568], [360,800], [390,844], [430,932], [568,320], [667,375], [844,390], [932,430], [768,1024], [820,1180], [1024,768], [1180,820], [1440,900]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(page, expression, label) {
  for (let i = 0; i < 150; i++) {
    if (await page.evaluate(expression)) return;
    await sleep(200);
  }
  throw new Error(`Não apareceu: ${label}`);
}
async function shot(page, name) {
  writeFileSync(join(OUT, `${name}.png`), Buffer.from((await page.screenshot()).data, "base64"));
}
async function tap(page, selector, hold = 70) {
  const p = await page.evaluate(`
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({block:"nearest"});
    const r = el.getBoundingClientRect();
    return {x:(Math.max(0,r.left)+Math.min(innerWidth,r.right))/2, y:(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2};
  `);
  assert(p, `alvo de toque existe: ${selector}`);
  await sleep(80);
  const hit = await page.evaluate(`const el=document.elementFromPoint(${p.x},${p.y});return Boolean(el?.closest(${JSON.stringify(selector)}));`);
  if(!hit) {
    await shot(page,"failure-touch");
    console.log(await page.evaluate(`return {point:${JSON.stringify(p)},hit:document.elementFromPoint(${p.x},${p.y})?.outerHTML.slice(0,500),rect:document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect().toJSON()};`));
  }
  assert(hit, `alvo recebe toque sem sobreposição: ${selector}`);
  await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
  await sleep(hold);
  await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(180);
}
const type = (selector, value) => `
  const el=document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,${JSON.stringify(value)});
  el.dispatchEvent(new Event("input",{bubbles:true})); return true;
`;
const fits = `
  const doc=document.documentElement;
  return {overflow:doc.scrollWidth>innerWidth+1, nav:[...document.querySelectorAll('header nav a, header nav button')].every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.height>=44;})};
`;

mkdirSync(OUT, {recursive:true});
const { child, port } = await launchChrome();
try {
  const page = await openPage(port);
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.setItem("yugioh-goat-profile-v1",${JSON.stringify(JSON.stringify({id:profile,name:profile}))});
    if(!localStorage.getItem("yugioh-goat-deck-v1"))localStorage.setItem("yugioh-goat-deck-v1",${JSON.stringify(JSON.stringify(deck))});
  ` });

  // Cada rota precisa caber de verdade: esconder overflow do body não basta.
  if(!process.env.MOBILE_DUEL_ONLY) {
  for (const [w,h] of process.env.MOBILE_INTERACTIONS_ONLY ? [] : sizes) {
    const mobile = w !== 1440;
    await page.setViewport(w,h,{mobile,touch:mobile});
    for (const path of ["/", "/duel", "/duel/online"]) {
      await page.goto(`${BASE}${path}`);
      await until(page, path === "/" ? 'return Boolean(document.querySelector("[data-virtual-grid]"))' : 'return Boolean(document.querySelector("[data-deck-preview]"))', path);
      await sleep(100);
      const m = await page.evaluate(fits);
      assert(!m.overflow, `${w}×${h} ${path}: sem overflow horizontal`);
      if(mobile) assert(m.nav, `${w}×${h} ${path}: navegação visível e tocável`);
      if(path === "/") {
        const grid = await page.evaluate('const el=document.querySelector("[data-virtual-grid]"); const r=el.getBoundingClientRect();return {h:r.height,bottom:r.bottom,scroll:document.documentElement.scrollHeight};');
        assert(grid.h>50 && grid.bottom<=h+1 && grid.scroll<=h+1, `${w}×${h}: catálogo visível, com rolagem interna (${JSON.stringify(grid)})`);
      }
      if([390,844,768,1024,1440].includes(w)) await shot(page,`${w}x${h}-${path.replaceAll("/", "-")||"builder"}`);
    }
    console.log(`OK ${w}×${h}: construtor, lobby bot e lobby online`);
  }

  // Um toque lê; só o botão explícito altera o deck. Inspeção no limite de cópias.
  await page.setViewport(390,844,{mobile:true,touch:true});
  await page.goto(`${BASE}/`);
  await until(page,'return Boolean(document.querySelector("[data-virtual-grid] button"))',"catálogo");
  const count = () => page.evaluate('return Number(document.querySelector("[data-builder-nav=deck]").textContent.match(/\\d+/)[0]);');
  const before = await count();
  await tap(page,"[data-virtual-grid] button");
  await until(page,'return Boolean(document.querySelector("[data-card-reader]"))',"leitura por toque");
  assert.equal(await count(),before,"ler não adiciona carta");
  await tap(page,"[data-reader-add]");
  assert.equal(await count(),before+1,"adicionar por toque");
  await tap(page,"[data-reader-remove]");
  assert.equal(await count(),before,"remover por toque");
  for(let i=0;i<3;i++) await tap(page,"[data-reader-add]");
  assert(await page.evaluate('return document.querySelector("[data-reader-add]").disabled'),"limite de cópias explícito");
  await shot(page,"390-reader");
  await tap(page,'[aria-label="Fechar detalhes da carta"]');
  await tap(page,"[data-virtual-grid] button");
  assert(await page.evaluate('return Boolean(document.querySelector("[data-card-reader]"))'),"carta no limite ainda pode ser lida");
  await tap(page,'[aria-label="Fechar detalhes da carta"]');
  await tap(page,'[data-builder-nav="deck"]');
  await tap(page,"[data-deck-drop] button[draggable]");
  assert(await page.evaluate('return Boolean(document.querySelector("[data-card-reader]"))'),"carta do deck abre leitura sem remover");
  await tap(page,'[aria-label="Fechar detalhes da carta"]');

  // A posição de rolagem do catálogo sobrevive à troca de aba.
  await tap(page,'[data-builder-nav="catalog"]');
  await page.evaluate('document.querySelector("[data-virtual-grid]").scrollTop=700;return true;');
  await sleep(150);
  await tap(page,'[data-builder-nav="library"]');
  await tap(page,'[data-builder-nav="catalog"]');
  assert(await page.evaluate('return document.querySelector("[data-virtual-grid]").scrollTop>600'),"trocar abas preserva rolagem");
  await tap(page,".builder-filters summary");
  assert(await page.evaluate('return document.querySelector(".builder-filters").open'),"filtros por toque");
  await tap(page,".builder-filters summary");
  await page.evaluate(type('[aria-label="Buscar cartas"]',"zzzznenhumacarta"));
  await until(page,'return document.body.innerText.includes("Nenhuma carta encontrada")',"busca vazia");

  // Ferramentas e leitura continuam utilizáveis com 320px de altura.
  await tap(page,'[data-builder-nav="library"]');
  await page.setViewport(568,320,{mobile:true,touch:true});
  await tap(page,'[data-tool="io"]');
  const box = await page.evaluate('const r=document.querySelector("[data-deck-tool]").getBoundingClientRect();return {top:r.top,bottom:r.bottom};');
  assert(box.top>=0 && box.bottom<=320,"importação cabe na paisagem baixa");
  await shot(page,"568-import");
  await tap(page,'[data-deck-tool] [aria-label="Fechar"]');
  await tap(page,'[data-builder-nav="deck"]');
  await tap(page,"[data-deck-drop] button[draggable]");
  const reader=await page.evaluate('const r=document.querySelector("[data-card-reader]").getBoundingClientRect();const t=document.querySelector("[data-card-reader] .md-detail-text");return {top:r.top,bottom:r.bottom,text:t.clientHeight};');
  await shot(page,"568-reader");
  assert(reader.top>=0 && reader.bottom<=320 && reader.text>=40,`leitura e ações cabem na paisagem baixa (${JSON.stringify(reader)})`);
  await tap(page,'[aria-label="Fechar detalhes da carta"]');
  console.log("OK toque: leitura, cópias, remoção, filtros, busca, abas, ferramentas e rotação");

  // As cartas do lobby abrem sobre o conteúdo, sem precisar procurar um painel acima.
  await page.setViewport(390,844,{mobile:true,touch:true});
  await page.goto(`${BASE}/duel`);
  await until(page,'return Boolean(document.querySelector("[data-deck-preview] button"))',"deck do lobby");
  await tap(page,"[data-deck-preview] button");
  assert(await page.evaluate('return Boolean(document.querySelector("[data-card-reader] img"))'),"leitura no lobby");
  await tap(page,'[aria-label="Fechar detalhes da carta"]');
  await page.goto(`${BASE}/duel/online`);
  await until(page,'return Boolean(document.querySelector(".room-code-entry"))',"lobby online");
  await tap(page,".room-code-entry input");
  await page.evaluate(type('.room-code-entry input',"ABCD"));
  assert(await page.evaluate('return !document.querySelector(".room-code-entry button").disabled'),"código habilita entrar na sala");
  await tap(page,".room-code-entry button");
  await until(page,'return document.body.innerText.includes("Estou pronto")',"sala online");
  assert(!(await page.evaluate(fits)).overflow,"sala online cabe no telefone");
  await shot(page,"390-online-room");
  } else {
    await page.goto(`${BASE}/`);
    await until(page,'return Boolean(document.querySelector("[data-virtual-grid]"))',"app");
  }

  // Motor real: comandos, busca no Deck, painéis e fim da partida por toque.
  const setup = {
    playerName: "Mobile", opponentName: "Bot", opponentId: "mobile-test", format: "tcg",
    playerDeck: {main:[...Array(20).fill(91152256),...Array(20).fill(2460565)],extra:[],side:[]},
    opponentDeck: {main:Array(40).fill(91152256),extra:[],side:[]},
    scenario:[{player:0,location:OcgLocation.HAND,code:32807846}],
  };
  for(const [w,h] of [[844,390],[568,320],[932,430],[844,300]]) {
    await page.setViewport(w,h,{mobile:true,touch:true});
    await page.evaluate(`sessionStorage.setItem("yugioh-goat-duel-setup-v1",${JSON.stringify(JSON.stringify(setup))});localStorage.setItem("yugioh-goat-tips-v1",JSON.stringify({off:true,seen:[]}));localStorage.setItem("yugioh-goat-duel-prefs-v1",JSON.stringify({speed:"faster",cutIns:false}));return true;`);
    await page.goto(`${BASE}/duel/play`);
    const card = '[data-hand="0"] [data-zone] .tf-slot-active';
    await until(page,`return Boolean(document.querySelector('${card}'))`,"mão jogável");
    const spell = await page.evaluate(`const el=[...document.querySelectorAll('[data-hand="0"] [data-zone]')].find(el=>/Refor|Reinforcement/.test(el.querySelector('img')?.alt??''));return el?.dataset.zone;`);
    assert(spell,"carta roteirizada na mão");
    const target=`[data-zone="${spell}"] .tf-touch-card`;
    await tap(page,target);
    const reader = await page.evaluate(`
      const el=document.querySelector('[data-landscape-reader]');
      const text=el?.querySelector('.md-detail-text');
      const field=document.querySelector('.md-field')?.getBoundingClientRect();
      const r=el?.getBoundingClientRect();
      return {image:Boolean(el?.querySelector('img')),textHeight:text?.clientHeight??0,
        beside: Boolean(r&&field&&r.right<=field.left+1),popup:Boolean(document.querySelector('[data-card-sheet]'))};
    `);
    assert(reader.image && reader.textHeight>=50 && reader.beside && !reader.popup,`leitura lateral por um toque: ${JSON.stringify(reader)}`);
    assert(!await page.evaluate('return Boolean(document.querySelector("[data-open-card]"))'),"sem botão de popup na horizontal");
    await page.send("Input.dispatchTouchEvent", {type:"touchStart",touchPoints:[{x:w-3,y:h-3}]});
    await page.send("Input.dispatchTouchEvent", {type:"touchEnd",touchPoints:[]});
    await sleep(180);
    assert(await page.evaluate('return Boolean(document.querySelector("[data-landscape-reader] img"))'),"leitura permanece ao fechar comandos");
    await shot(page,`${w}x${h}-landscape-reader`);
    await tap(page,target);
    await until(page,'return Boolean(document.querySelector("[data-command=activate]"))',"comando Ativar");
    await tap(page,'[data-command="activate"]');
    await until(page,'return Boolean(document.querySelector(".tf-slot-place"))',"escolha de zona");
    await tap(page,".tf-slot-place");
    await until(page,'return Boolean(document.querySelector("[data-decision-dialog] .md-tile"))',"busca no Deck");
    await page.evaluate('return Promise.all(document.querySelector("[data-decision-dialog]").getAnimations().map(animation=>animation.finished.catch(()=>{})));');
    const dialog = await page.evaluate('const el=document.querySelector("[data-decision-dialog]");const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width};');
    assert(dialog.top>=0&&dialog.bottom<=h+1&&dialog.width<=w,`decisão cabe na tela: ${JSON.stringify(dialog)}`);
    await shot(page,`${w}-duel-decision`);
    await tap(page,"[data-decision-dialog] .md-tile");
    await tap(page,"[data-peek]");
    assert(await page.evaluate('return document.querySelector("[data-decision-dialog]").offsetParent===null'),"espiar preserva decisão");
    // Rotações não recomeçam a partida nem perdem a seleção.
    await page.setViewport(390,844,{mobile:true,touch:true});
    assert(await page.evaluate('return Boolean(document.querySelector("[data-orientation-hint]"))'),"dica de orientação no telefone");
    await page.setViewport(w,h,{mobile:true,touch:true});
    await until(page,'return Boolean(document.querySelector("[data-landscape-reader] [data-return-decision]"))',"decisão voltou para a lateral após girar");
    await tap(page,"[data-return-decision]");
    assert(await page.evaluate('return Boolean(document.querySelector(".md-tile-picked"))'),"seleção sobrevive à rotação");
    await tap(page,"[data-decision-dialog] .md-tile-picked");
    await until(page,'return !document.querySelector("[data-decision-dialog]")',"busca concluída");
    await tap(page,"[data-open-log]");
    await tap(page,'[aria-label="Fechar o registro"]');
    assert(await page.evaluate('return Boolean(document.querySelector(".md-hud-buttons [data-fullscreen-toggle]"))'),"tela cheia junto dos controles da mesa");
    if(w===844 && h===390 && await page.evaluate('return document.querySelector("[data-fullscreen-toggle]")?.dataset.fullscreenSupported === "true"')) {
      await tap(page,"[data-fullscreen-toggle]");
      await until(page,'return document.fullscreenElement===document.documentElement',"tela cheia real");
      assert(await page.evaluate('return document.querySelector("[data-fullscreen-toggle]").getAttribute("aria-pressed")==="true"'),"botão acompanha tela cheia");
      await tap(page,"[data-fullscreen-toggle]");
      await until(page,'return !document.fullscreenElement',"sair de tela cheia");
      console.log("OK tela cheia: entrada e saída por toque, incluindo os menus em portal");
      await page.evaluate('document.documentElement.requestFullscreen=async()=>{throw new Error("Negado no teste");};return true;');
      await tap(page,"[data-fullscreen-toggle]");
      await until(page,'return document.querySelector("[data-fullscreen-help] [role=status]")?.textContent.includes("não permitiu")',"recusa do navegador tem orientação");
      await tap(page,'[aria-label="Fechar ajuda de tela cheia"]');
      await page.evaluate('delete document.documentElement.requestFullscreen;Object.defineProperty(document,"fullscreenEnabled",{configurable:true,value:false});document.dispatchEvent(new Event("fullscreenchange"));return true;');
      await tap(page,"[data-fullscreen-toggle]");
      await until(page,'return Boolean(document.querySelector("[data-fullscreen-help] [data-home-screen-help][open]"))',"ajuda direta quando a API não está disponível");
      assert(await page.evaluate('const r=document.querySelector("[data-fullscreen-help]").getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1&&r.left>=0&&r.right<=innerWidth+1;'),"ajuda de tela cheia cabe no telefone");
      await tap(page,'[aria-label="Fechar ajuda de tela cheia"]');
      await page.evaluate('delete document.fullscreenEnabled;document.dispatchEvent(new Event("fullscreenchange"));return true;');
      console.log("OK tela cheia: recusa e falta de suporte mostram instruções sem sair do campo");
    }
    await tap(page,"[data-duel-settings]");
    assert(await page.evaluate('return !document.querySelector("[data-duel-settings-panel] [data-fullscreen-toggle]")'),"atalho de tela cheia fora do menu");
    const settings=await page.evaluate('const r=document.querySelector("[data-duel-settings-panel]").getBoundingClientRect();return {top:r.top,bottom:r.bottom};');
    assert(settings.top>=0&&settings.bottom<=h+1,"configurações e rodapé cabem");
    await shot(page,`${w}-duel-settings`);
    await tap(page,"[data-surrender]");
    await tap(page,"[data-surrender]");
    await until(page,'return Boolean(document.querySelector("[data-result]"))',"resultado");
    await sleep(1000);
    await shot(page,`${w}-duel-result`);
    await tap(page,"[data-rematch]");
    await until(page,`return Boolean(document.querySelector('${card}'))`,"revanche");
    console.log(`OK ${w}×${h}: duelo por toque, leitura, Ativar, zona, seleção, espiar, rotação, histórico, configurações, rendição e revanche`);
  }
  const manifest=await (await fetch(`${BASE}/manifest.webmanifest`)).json();
  assert.equal(manifest.display,"standalone","abertura como aplicativo");
  assert(manifest.icons.some(icon=>icon.sizes==="512x512"),"ícone instalável");
  assert.equal(await page.evaluate(`return document.querySelector('meta[name="theme-color"]').content`),"#061226","barra na cor da mesa");
  assert.equal(page.errors.length,0,`sem erros JS: ${page.errors.join("; ")}`);
  console.log("OK lobby e sala online por toque; sem erros JavaScript");
} finally {
  child.kill();
  rmSync(join(REPO,".data/decks",`${profile}.json`),{force:true});
}
