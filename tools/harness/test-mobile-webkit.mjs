/** QA opcional no WebKit. Instalação isolada e comando em README.md. */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO } from "./env.mjs";
const moduleUrl = process.env.PLAYWRIGHT_MODULE ?? pathToFileURL(join(REPO, ".cache/mobile-webkit/node_modules/playwright/index.mjs")).href;
const { webkit } = await import(moduleUrl);
const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const OUT = join(REPO, ".cache/shots/mobile");
import {readFileSync, mkdirSync,rmSync} from 'node:fs';
import assert from 'node:assert/strict';
const profile=`harness-webkit-${process.pid}`;
const preset=JSON.parse(readFileSync(join(REPO,'src/data/preset-decks.json'),'utf8'))[0];
const counts=new Map();for(const code of preset.main)counts.set(code,(counts.get(code)??0)+1);
const deck={id:'webkit-deck',name:'WebKit',format:'goat',main:[...counts].map(([passcode,quantity])=>({passcode,quantity})),extra:[],side:[],updatedAt:new Date().toISOString()};
const browser=await webkit.launch();
mkdirSync(OUT,{recursive:true});
try {
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await context.addInitScript(({profile,deck})=>{localStorage.setItem('yugioh-goat-profile-v1',JSON.stringify({id:profile,name:profile}));if(!localStorage.getItem('yugioh-goat-deck-v1'))localStorage.setItem('yugioh-goat-deck-v1',JSON.stringify(deck));},{profile,deck});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const [width,height] of [[390,844],[844,390],[568,320],[768,1024],[1024,768]]) {
  await page.setViewportSize({width,height});
  for(const path of ['/','/duel','/duel/online']) {
   await page.goto(BASE+path);
   await page.locator(path==='/'?'[data-virtual-grid]':'[data-deck-preview]').first().waitFor();
   const m=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,grid:document.querySelector('[data-virtual-grid]')?.getBoundingClientRect().toJSON()}));
   assert(!m.overflow,`${width} ${path} overflow`);
   if(path==='/'){assert(m.grid.height>50&&m.grid.bottom<=height+1,'grid');await page.locator('[data-virtual-grid] button').first().tap();await page.locator('[data-card-reader]').waitFor();await page.locator('[data-reader-add]').tap();await page.screenshot({path:join(OUT,`webkit-${width}-reader.png`)});await page.getByRole('button',{name:'Fechar detalhes da carta'}).tap();}
  }
  console.log(`OK WebKit ${width}×${height}: construtor, leitura, edição, lobby bot, lobby online`);
 }
 const setup={playerName:'WebKit',opponentName:'Bot',opponentId:'test',format:'tcg',playerDeck:{main:[...Array(20).fill(91152256),...Array(20).fill(2460565)],extra:[],side:[]},opponentDeck:{main:Array(40).fill(91152256),extra:[],side:[]},scenario:[{player:0,location:2,code:32807846}]};
 for(const [width,height] of [[844,390],[568,320]]) {
  await page.setViewportSize({width,height});
  await page.evaluate(setup=>{sessionStorage.setItem('yugioh-goat-duel-setup-v1',JSON.stringify(setup));localStorage.setItem('yugioh-goat-tips-v1',JSON.stringify({off:true,seen:[]}));localStorage.setItem('yugioh-goat-duel-prefs-v1',JSON.stringify({speed:'faster',cutIns:false}));},setup);
  await page.goto(BASE+'/duel/play');
  const target=page.locator('[data-hand="0"] [data-zone]').filter({has:page.locator('img[alt*="Reinforcement"],img[alt*="Refor"]')}).locator('.tf-touch-card');
  await target.waitFor();await page.waitForFunction(()=>Boolean(document.querySelector('[data-hand="0"] .tf-slot-active')));
  await target.tap();
  assert(await page.locator('[data-landscape-reader] img').count(), 'leitura lateral por toque');
  assert.equal(await page.locator('[data-card-sheet]').count(),0,'sem popup');
  const reader=await page.locator('[data-landscape-reader]').boundingBox();
  const field=await page.locator('.md-field').boundingBox();
  assert(reader.x+reader.width<=field.x+1,'leitor ao lado do campo');
  await page.touchscreen.tap(width-3,height-3);
  assert(await page.locator('[data-landscape-reader] img').count(),'leitura permanece ao fechar comandos');
  await page.screenshot({path:join(OUT,`webkit-${width}-landscape-reader.png`)});
  await target.tap();
  await page.locator('[data-command="activate"]').tap();await page.locator('.tf-slot-place').first().tap();
  await page.locator('[data-decision-dialog] .md-tile').first().waitFor();
  await page.locator('[data-decision-dialog]').evaluate(async el => {
    await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
  const r=await page.locator('[data-decision-dialog]').boundingBox();assert(r.y>=0&&r.y+r.height<=height+1,'decision fits');
  await page.screenshot({path:join(OUT,`webkit-${width}-duel.png`)});
  await page.locator('[data-decision-dialog] .md-tile').first().tap();await page.locator('[data-decision-dialog] .md-tile-picked').tap();
  await page.locator('[data-duel-settings]').tap();
  await page.locator('[data-duel-settings-panel]').evaluate(async el => {
    await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
  const settings=await page.locator('[data-duel-settings-panel]').boundingBox();assert(settings.y>=0&&settings.y+settings.height<=height+1,'settings fits');
  await page.locator('[data-surrender]').tap();await page.locator('[data-surrender]').tap();await page.locator('[data-result]').waitFor();await page.locator('[data-rematch]').tap();await page.locator('[data-hand="0"] .tf-slot-active').first().waitFor();
  console.log(`OK WebKit ${width}×${height}: duelo, Ativar, zona, busca, configurações, rendição e revanche`);
 }
 assert.equal(errors.length,0,errors.join(';'));
 console.log('OK WebKit: sem erros JavaScript');
}finally{await browser.close();rmSync(join(REPO,'.data/decks',`${profile}.json`),{force:true});}
