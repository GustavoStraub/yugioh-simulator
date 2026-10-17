import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO } from "./env.mjs";

const moduleUrl = process.env.PLAYWRIGHT_MODULE ?? pathToFileURL(join(REPO, ".cache/mobile-webkit/node_modules/playwright/index.mjs")).href;
const { chromium } = await import(moduleUrl);
const BASE = process.env.APP_URL ?? "http://127.0.0.1:3100";
const book = 14087893, elf = 15025844;
const deck = { main: Array(40).fill(5053103), extra: [], side: [] };
const setup = {
  playerName: "Alvos", opponentName: "Bot", opponentId: "chain-target-test", format: "goat",
  playerDeck: deck, opponentDeck: deck,
  scenario: [
    ...[0, 1].map((sequence) => ({ player: 1, location: 4, sequence, code: elf, position: 1 })),
    { player: 0, location: 4, sequence: 0, code: elf, position: 1 },
    ...Array.from({ length: 3 }, () => ({ player: 0, location: 2, code: book })),
  ],
};
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  await context.addInitScript(() => {
    localStorage.setItem("yugioh-goat-profile-v1", JSON.stringify({ id: "harnesschaintarget", name: "Alvos" }));
    localStorage.setItem("yugioh-goat-tips-v1", JSON.stringify({ off: true, seen: [] }));
    localStorage.setItem("yugioh-goat-duel-prefs-v1", JSON.stringify({ speed: "normal", cutIns: false, holograms: "off" }));
  });
  page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(BASE);
  await page.evaluate((setup) => sessionStorage.setItem("yugioh-goat-duel-setup-v1", JSON.stringify(setup)), setup);
  await page.goto(`${BASE}/duel/play`);
  await page.waitForSelector('[data-phase-options*="EP"]');
  await page.locator('[data-chain-mode="auto"]').click();
  await page.waitForSelector('[data-chain-mode="always"]');
  await page.locator('[data-zone^="0:2:"] .tf-slot-active').filter({ has: page.locator(`img[src*="${book}"]`) }).first().click();
  await page.locator('[data-command="activate"]').click();
  await page.locator('[data-zone="0:8:0"] .tf-slot-place').click();
  await page.locator('[data-zone="1:4:0"] .tf-slot-active').click();
  const confirm = page.getByRole('button', { name: /^Confirmar/ });
  if (await confirm.isVisible()) await confirm.click();
  await page.waitForSelector('[data-chain-target-for="1:4:0"]');
  assert.equal(await page.locator('[data-chain-target-for="1:4:0"]').getAttribute('data-target-links'), '1');
  assert.equal(await page.locator('[data-chain-target-for="1:4:1"]').count(), 0, "cópia vizinha não é alvo");
  await page.waitForSelector('[data-chain-response-targets]');
  assert.match(await page.locator('[data-chain-response-targets]').innerText(), /Monstro 1/);

  await page.locator('[data-chain-card]').filter({ has: page.locator(`img[src*="${book}"]`) }).first().click();
  await page.locator('[data-chain-response]').getByRole('button', { name: /^Ativar/ }).click();
  const secondPlace = page.locator('[data-zone="0:8:1"] .tf-slot-place');
  await page.waitForFunction(() => document.querySelector('[data-zone="1:4:1"] .tf-slot-active') || document.querySelector('.tf-slot-place'));
  if (await secondPlace.isVisible()) await secondPlace.click();
  await page.locator('[data-zone="1:4:1"] .tf-slot-active').click();
  if (await confirm.isVisible()) await confirm.click();
  await page.waitForSelector('[data-chain-target-for="1:4:1"][data-target-links="2"]');
  assert.equal(await page.locator('[data-chain-target-for]').count(), 2);
  assert.match(await page.locator('[data-chain-row="1"] [data-chain-target-label]').innerText(), /Monstro 1/);
  assert.match(await page.locator('[data-chain-row="2"] [data-chain-target-label]').innerText(), /Monstro 2/);
  await page.locator('[data-chain-inspect="1"]').hover();
  await page.waitForSelector('[data-chain-targets][data-inspected-chain="1"]');
  assert.match(await page.locator('[data-chain-target-for="1:4:0"] [data-chain-target-arrow]').getAttribute('d'), /^M .+ L /);
  assert.equal(await page.locator('[data-chain-target-for="1:4:1"] [data-chain-target-arrow]').getAttribute('d'), '');
  mkdirSync(join(REPO, ".cache/shots"), { recursive: true });
  await page.screenshot({ path: join(REPO, ".cache/shots/chain-targets-desktop.png") });
  await page.locator('[data-chain-inspect="2"]').focus();
  await page.waitForSelector('[data-chain-targets][data-inspected-chain="2"]');
  await page.mouse.move(2, 2);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForSelector('[data-landscape-reader]');
  await page.waitForSelector('[data-chain-target-for="1:4:1"]');
  await page.locator('[data-view-chain-targets]').tap();
  await page.locator('[data-open-log]').tap();
  await page.locator('[data-chain-inspect="1"]').tap();
  await page.waitForFunction(() => !document.querySelector('[data-log-sheet]'));
  await page.waitForSelector('[data-chain-targets][data-inspected-chain="1"]');
  await page.screenshot({ path: join(REPO, ".cache/shots/chain-targets-mobile.png") });

  await page.evaluate(() => {
    window.__targetResolutions = [];
    const observer = new MutationObserver(() => {
      for (const target of document.querySelectorAll('[data-target-resolving]')) {
        window.__targetResolutions.push(target.getAttribute('data-target-links'));
      }
    });
    observer.observe(document.querySelector('[data-field]'), { childList: true, subtree: true, attributes: true, attributeFilter: ['data-target-resolving'] });
  });
  await page.getByRole('button', { name: 'Não responder', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-chain-targets]'));
  const resolutions = await page.evaluate(() => window.__targetResolutions);
  assert(resolutions.includes('2') && resolutions.includes('1'), 'miras acompanham a resolução dos dois elos');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log("✓ Alvos por elo, cópias iguais, resposta, inspeção com mouse/teclado, celular, resolução e limpeza");
} catch (error) {
  console.log(await page?.locator('body').innerText());
  mkdirSync(join(REPO, ".cache/shots"), { recursive: true });
  await page?.screenshot({ path: join(REPO, ".cache/shots/chain-targets-error.png") });
  throw error;
} finally { await browser.close(); }
