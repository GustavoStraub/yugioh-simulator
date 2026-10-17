/** Lobby, persistência, migração, revanche e espectador em Chrome real. */
import assert from 'node:assert/strict';
import {existsSync,readFileSync,rmSync} from 'node:fs';
import {launchChrome,openPage} from './browser.mjs';
const base=process.env.APP_URL??'http://127.0.0.1:3000';
const id=`bot-difficulty-${Date.now()}`;
const {child,port}=await launchChrome();const page=await openPage(port);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(js){for(let i=0;i<400;i++){if(await page.evaluate(js).catch(()=>false))return;await delay(150);}throw Error(`Timeout: ${js}`);}
async function choose(label,value){
 await page.evaluate(`document.querySelector('button[aria-label="${label}"]').click();return true;`);
 await until(`return Boolean(document.querySelector('[popover]:popover-open [data-value="${value}"]'));`);
 await page.evaluate(`document.querySelector('[popover]:popover-open [data-value="${value}"]').click();return true;`);
}
try{
 await page.goto(base+'/duel');
 await page.evaluate(`localStorage.setItem('yugioh-goat-profile-v1',JSON.stringify({id:${JSON.stringify(id)},name:'Teste Níveis'}));localStorage.setItem('yugioh-goat-tips-v1',JSON.stringify({off:true,seen:[]}));localStorage.setItem('yugioh-goat-duel-prefs-v1',JSON.stringify({speed:'faster',cutIns:false,holograms:'off',chainMode:'auto'}));return true;`);
 await page.goto(base+'/duel');await until(`return Boolean(document.querySelector('button[aria-label="Seu deck"]'));`);
 assert.equal(await page.evaluate(`return document.querySelector('[data-bot-difficulty="Nível do oponente"] input:checked').value;`),'medium');
 await choose('Seu deck','tcg-sdy');await choose('Deck do bot','tcg-sdaz');
 assert.ok(await page.evaluate(`return document.querySelector('[data-bot-coverage]').textContent.includes('3 rotas');`));
 await page.evaluate(`document.querySelector('[data-bot-difficulty="Nível do oponente"] input[value="hard"]').click();document.querySelector('[data-first-turn="bot"]').click();return true;`);
 await page.clickText('Iniciar duelo vs bot');
 await until(`return Boolean(document.querySelector('[data-turn-owner="me"]'));`);
 assert.ok(await page.evaluate(`const s=JSON.parse(sessionStorage.getItem('yugioh-goat-duel-setup-v1'));return s.botDifficulty==='hard'&&s.humanSeat===1;`));
 await page.evaluate(`document.querySelector('button[aria-label="Configurações do duelo"]').click();return true;`);
 assert.ok(await page.clickAction('🏳️ Render-se'));await delay(200);assert.ok(await page.clickAction('🏳️ Confirmar rendição?'));
 await until(`return Boolean(document.querySelector('[data-rematch]'));`);
 await page.evaluate(`document.querySelector('[data-rematch]').click();return true;`);
 await until(`return !document.querySelector('[data-result]')&&Boolean(document.querySelector('[data-turn-owner="me"]'));`);
 assert.equal(await page.evaluate(`return JSON.parse(sessionStorage.getItem('yugioh-goat-duel-setup-v1')).botDifficulty;`),'hard');
 console.log('✓ lobby e cobertura; nível acompanha bot que começa e permanece na revanche');
 await page.goto(base+'/duel');await until(`return Boolean(document.querySelector('button[aria-label="Seu deck"]'));`);
 await choose('Seu deck','tcg-sdaz');await choose('Deck do bot','tcg-sdaz');
 await page.evaluate(`document.querySelector('[data-bot-difficulty="Nível do oponente"] input[value="hard"]').click();document.querySelector('details').open=true;document.querySelector('[data-bot-difficulty="Nível do bot com seu deck"] input[value="easy"]').click();return true;`);
 await page.evaluate(`document.querySelector('[data-spectate]').click();return true;`);
 await until(`return Boolean(document.querySelector('.md-duel'));`);
 assert.ok(await page.evaluate(`const s=JSON.parse(sessionStorage.getItem('yugioh-goat-duel-setup-v1'));return s.spectate&&s.botDifficulty==='hard'&&s.playerBotDifficulty==='easy';`));
 console.log('✓ bot × bot guarda níveis independentes');
 await page.evaluate(`const s=JSON.parse(sessionStorage.getItem('yugioh-goat-duel-setup-v1'));delete s.botDifficulty;delete s.playerBotDifficulty;delete s.spectate;sessionStorage.setItem('yugioh-goat-duel-setup-v1',JSON.stringify(s));return true;`);
 await page.goto(base+'/duel/play');await until(`return Boolean(document.querySelector('[data-turn-owner="me"]'));`);
 assert.equal(page.errors.length,0,page.errors.join('\n'));
 console.log('✓ configuração antiga abre e migra para Médio sem exceções');
 await page.goto(base+'/duel');await until(`return Boolean(document.querySelector('[data-bot-difficulty]'));`);
 await page.setViewport(390,844,{mobile:true,touch:true});
 assert.ok(await page.evaluate(`return document.documentElement.scrollWidth<=innerWidth+1;`),'controles cabem no celular');
}finally{await page.close();child.kill();const f=`.data/decks/${id}.json`;if(existsSync(f)){assert.equal(JSON.parse(readFileSync(f,'utf8')).profile.id,id);rmSync(f);}}
