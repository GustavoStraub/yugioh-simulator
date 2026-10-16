/** A End Phase explica a ordem obrigatória sem fingir uma ativação/corrente. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { OcgLocation as L, OcgPosition as P } from "@n1xx1/ocgcore-wasm";
import { launchChrome, openPage } from "./browser.mjs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3100";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const SWORDS = 72302403;
const { child, port } = await launchChrome({ headless: !process.argv.includes("--headed") });
try {
  const page = await openPage(port);
  await page.setViewport(1440, 900);
  await page.goto(`${BASE}/duel`);
  const setup = {
    playerName: "Teste obrigatório", opponentName: "Oponente", opponentId: "teste", format: "goat",
    playerDeck: { main: Array(40).fill(25833572), extra: [], side: [] },
    opponentDeck: { main: Array(40).fill(25833572), extra: [], side: [] },
    scenario: [
      { player: 0, location: L.HAND, code: SWORDS },
      { player: 0, location: L.SZONE, sequence: 1, code: 5318639, position: P.FACEDOWN_DEFENSE },
    ],
  };
  await page.evaluate(`
    localStorage.setItem('yugioh-goat-profile-v1', JSON.stringify({ id: 'harnessmandatory', name: 'Teste obrigatório' }));
    localStorage.setItem('yugioh-goat-duel-prefs-v1', JSON.stringify({ holograms: 'off' }));
    localStorage.setItem('yugioh-goat-tips-v1', JSON.stringify({ off: true, seen: [] }));
    sessionStorage.setItem('yugioh-goat-duel-setup-v1', ${JSON.stringify(JSON.stringify(setup))});
  `);
  await page.goto(`${BASE}/duel/play`);
  const panel = () => page.evaluate(`
    const p = document.querySelector('[data-chain-response]');
    return p && p.offsetParent !== null ? p.innerText : '';
  `);
  let activated = false;
  let reached = false;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (/Efeito obrigatório pendente/.test(await panel())) { reached = true; break; }
    if (!activated) {
      const clicked = await page.evaluate(`
        const z = [...document.querySelectorAll('[data-zone^="0:2:"]')].find(e => e.querySelector('img')?.src.includes('${SWORDS}') && e.querySelector('.tf-slot-active'));
        z?.querySelector('[role="button"]')?.click(); return Boolean(z);
      `);
      if (clicked) { await delay(100); activated = await page.clickAction("Ativar"); }
    } else {
      await page.evaluate(`document.querySelector('.tf-slot-place')?.click();`);
      await page.clickAction("Não responder");
      await page.clickAction("Encerrar turno");
    }
    await delay(120);
  }
  assert(reached, "chegou à escolha de ordem da Espada na End Phase");
  const text = await panel();
  assert.match(text, /escolha o que acontece primeiro/);
  assert.match(text, /usar outra carta antes do efeito obrigatório, mas não pulá-lo/);
  assert.match(text, /Sem outra escolha, o jogo segue automaticamente/);
  assert.doesNotMatch(text, /precisa encadear|Ativar uma carta em resposta|Não responder/);
  assert.equal(await page.evaluate(`return document.querySelectorAll('[data-chain-card]').length;`), 2);
  mkdirSync(".cache/shots", { recursive: true });
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewport(width, height, { mobile: width < 1000, touch: width < 1000 });
    await delay(250);
    assert.match(await panel(), /escolha o que acontece primeiro/);
    writeFileSync(`.cache/shots/mandatory-${width}.png`, Buffer.from((await page.screenshot()).data, "base64"));
  }
  await page.setViewport(1440, 900);
  assert(await page.evaluate(`
    const tile = [...document.querySelectorAll('[data-chain-card]')].find(e => e.querySelector('img')?.src.includes('${SWORDS}'));
    tile?.click(); return Boolean(tile);
  `));
  await delay(100);
  assert(await page.clickAction("Usar efeito"));
  let advanced = false;
  for (let i = 0; i < 100; i += 1) {
    const current = await panel();
    if (/Não responder/.test(current)) {
      assert.doesNotMatch(current, /Efeito obrigatório pendente/);
      assert(await page.clickAction("Não responder"));
      advanced = true;
      break;
    }
    await delay(100);
  }
  assert(advanced, "resolvida a contagem, as respostas opcionais continuam disponíveis");
  assert.equal(page.errors.length, 0, page.errors.join("\n"));
  console.log("✓ desktop/mobile: escolha de ordem clara, contagem resolvida e alternativa opcional preservada");
} finally {
  child.kill();
}
