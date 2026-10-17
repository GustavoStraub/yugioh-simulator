/** Vínculos reais do engine: cartas iguais, vários equipamentos e consulta por toque. */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO } from "./env.mjs";

const moduleUrl = process.env.PLAYWRIGHT_MODULE ?? pathToFileURL(join(REPO, ".cache/mobile-webkit/node_modules/playwright/index.mjs")).href;
const { chromium } = await import(moduleUrl);
const BASE = process.env.APP_URL ?? "http://127.0.0.1:3100";
const axe = 40619825;
const elf = 15025844;
const deck = { main: Array(40).fill(5053103), extra: [], side: [] };
const setup = {
  playerName: "Equipamentos", opponentName: "Bot", opponentId: "equipment-test", format: "goat",
  playerDeck: deck, opponentDeck: deck,
  scenario: [
    ...[0, 1].map((sequence) => ({ player: 0, location: 4, sequence, code: elf, position: sequence ? 4 : 1 })),
    { player: 1, location: 4, sequence: 0, code: elf, position: 1 },
    ...Array.from({ length: 3 }, () => ({ player: 0, location: 2, code: axe })),
  ],
};
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  await context.addInitScript(() => {
    localStorage.setItem("yugioh-goat-profile-v1", JSON.stringify({ id: "harnessequipment", name: "Equipamentos" }));
    localStorage.setItem("yugioh-goat-tips-v1", JSON.stringify({ off: true, seen: [] }));
    localStorage.setItem("yugioh-goat-duel-prefs-v1", JSON.stringify({ speed: "faster", cutIns: false, holograms: "off" }));
  });
  page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(BASE);
  await page.evaluate((setup) => sessionStorage.setItem("yugioh-goat-duel-setup-v1", JSON.stringify(setup)), setup);
  await page.goto(`${BASE}/duel/play`);
  await page.waitForSelector('[data-zone="0:4:0"] .md-card-on');

  for (const [index, target] of ["0:4:0", "0:4:0", "1:4:0"].entries()) {
    const hand = page.locator('[data-zone^="0:2:"] .tf-slot-active').filter({ has: page.locator(`img[src*="${axe}"]`) }).first();
    await hand.click();
    await page.getByRole("button", { name: /^Ativar/ }).click();
    const deadline = Date.now() + 30_000;
    let selected = false;
    while (Date.now() < deadline) {
      const count = await page.locator('[data-zone^="0:8:"] [data-marks]').count();
      if (count >= index + 1) break;
      const picked = await page.evaluate(({ target, selected }) => {
        const visible = (el) => el && el.getBoundingClientRect().width && el.getBoundingClientRect().height;
        const place = [...document.querySelectorAll('.tf-slot-place')].find(visible);
        const card = document.querySelector(`[data-zone="${target}"] .tf-slot-active`);
        const confirm = [...document.querySelectorAll('button')].find((el) => visible(el) && !el.disabled && /^(Confirmar|Concluir|Não responder)/.test(el.innerText.trim()));
        if (place) place.click();
        else if (!selected && visible(card)) { card.click(); return true; }
        else if (confirm) confirm.click();
        return selected;
      }, { target, selected });
      selected = picked;
      await page.waitForTimeout(150);
    }
    assert.equal(await page.locator('[data-zone^="0:8:"] [data-marks]').count(), index + 1, `equipamento ${index + 1} resolveu`);
  }
  await page.mouse.click(1400, 890);
  await page.locator('[data-zone="0:4:0"] .md-card-plane').hover();
  await page.waitForSelector('[data-equipment-path="1"]');
  assert.equal(await page.locator('[data-equipment-to="0:4:0"]').count(), 2, "monstro destaca seus dois equipamentos");
  assert.equal(await page.locator('[data-equipment-related]').count(), 3, "apenas o monstro e seus equipamentos recebem realce");
  assert.equal(await page.locator('[data-zone="0:4:1"] [data-equipment-related]').count(), 0, "cópia idêntica em outra zona não recebe realce");
  const from = await page.locator('[data-equipment-path="0"]').getAttribute("data-equipment-from");
  await page.locator(`[data-zone="${from}"] .md-card-plane`).hover();
  await page.waitForFunction(() => document.querySelectorAll('[data-equipment-path]').length === 1);
  assert.equal(await page.locator('[data-equipment-path]').getAttribute("data-equipment-to"), "0:4:0");
  assert.match(await page.locator('[data-equipment-path]').getAttribute("d"), /^M .+ L /, "seta medida na mesa");
  await page.mouse.move(1400, 890);
  await page.waitForFunction(() => !document.querySelector('[data-equipment-links]'));
  assert.equal(await page.locator('[data-equipment-related]').count(), 0, "sair da carta limpa os realces");

  await page.locator('[data-zone="1:4:0"] .md-card-plane').hover();
  await page.waitForSelector('[data-equipment-to="1:4:0"]');
  assert.equal(await page.locator('[data-equipment-path]').count(), 1, "equipamento em monstro adversário mantém o vínculo correto");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector('[data-equipment-links]'));
  await page.locator('[data-zone="0:4:0"] .md-card-plane').focus();
  await page.waitForSelector('[data-equipment-path="1"]');
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForSelector('[data-landscape-reader]');
  await page.locator('[data-zone="0:4:0"] .md-card-plane').tap();
  await page.waitForSelector('[data-equipment-path="1"]');
  await page.waitForFunction(() => document.querySelector('[data-preview-marks]')?.textContent.includes("Equipamentos:"));
  assert.equal(await page.locator('[data-equipment-related]').count(), 3, "toque mantém as ligações visíveis");
  await page.waitForTimeout(200);
  const before = await page.locator('[data-equipment-path="0"]').getAttribute("d");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction((before) => document.querySelector('[data-equipment-path="0"]')?.getAttribute("d") !== before, before);
  assert.equal(await page.locator('[data-equipment-path]').count(), 2, "setas acompanham a rotação da tela");
  await page.keyboard.press("Escape"); // Fecha o menu de jogadas aberto pelo toque.
  await page.locator('[data-zone="0:4:1"] .md-card-plane').tap();
  await page.waitForFunction(() => !document.querySelector('[data-equipment-links]'));
  await page.keyboard.press("Escape");
  await page.locator(`[data-zone="${from}"] .md-card-plane`).tap();
  await page.waitForSelector('[data-equipment-path]');
  await page.locator('[data-open-card]').click();
  await page.waitForFunction(() => document.querySelector('[data-preview-marks]')?.textContent.includes("Equipada a"));
  assert.equal(await page.locator('[data-equipment-path]').count(), 1, "abrir os detalhes preserva o vínculo");
  await page.keyboard.press("Escape");
  await page.locator(`[data-zone="${from}"] .md-card-plane`).tap();
  await page.touchscreen.tap(2, 840);
  await page.waitForFunction(() => !document.querySelector('[data-equipment-links]'));
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("✓ Equipamentos: várias ligações, cópias iguais, adversário, mouse, teclado, toque e rotação");
  mkdirSync(join(REPO, ".cache/shots"), { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-zone="0:4:0"] .md-card-plane').hover();
  await page.waitForSelector('[data-equipment-path="1"]');
  await page.screenshot({ path: join(REPO, ".cache/shots/equipment-links.png") });
} catch (error) {
  console.log(await page?.locator('body').innerText());
  mkdirSync(join(REPO, ".cache/shots"), { recursive: true });
  await page?.screenshot({ path: join(REPO, ".cache/shots/equipment-error.png") });
  throw error;
} finally {
  await browser.close();
}
