/** #7: a escolha de posição mostra o monstro, inclusive durante uma corrente. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { OcgLocation as L, OcgPosition as P } from "@n1xx1/ocgcore-wasm";
import { launchChrome, openPage } from "./browser.mjs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3100";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hand = (code) => ({ player: 0, location: L.HAND, code });
const cases = [
  { name: "ritual", spell: 55761792, monster: 5405694, extra: [], scenario: [
    hand(55761792), hand(5405694),
    { player: 0, location: L.MZONE, code: 89631139, sequence: 0, position: P.FACEUP_ATTACK },
  ] },
  { name: "ressurreicao", spell: 83764718, monster: 46986414, extra: [], scenario: [
    hand(83764718), { player: 0, location: L.GRAVE, code: 46986414 },
  ] },
  { name: "fusao", spell: 24094653, monster: 41462083, extra: [41462083], scenario: [
    hand(24094653), hand(71625222), hand(88819587),
  ] },
];
const { child, port } = await launchChrome({ headless: !process.argv.includes("--headed") });
try {
  const page = await openPage(port);
  await page.setViewport(1440, 900);
  await page.goto(`${BASE}/duel`);
  for (const c of cases) {
    const setup = {
      playerName: "Teste posição", opponentName: "Oponente", opponentId: "teste", format: "tcg",
      playerDeck: { main: Array(40).fill(25833572), extra: c.extra, side: [] },
      opponentDeck: { main: Array(40).fill(25833572), extra: [], side: [] },
      scenario: c.scenario,
    };
    await page.evaluate(`
      localStorage.setItem("yugioh-goat-profile-v1", JSON.stringify({ id: "harnessposition", name: "Teste posição" }));
      localStorage.setItem("yugioh-goat-duel-prefs-v1", JSON.stringify({ holograms: "off" }));
      localStorage.setItem("yugioh-goat-tips-v1", JSON.stringify({ off: true, seen: [] }));
      sessionStorage.setItem("yugioh-goat-duel-setup-v1", ${JSON.stringify(JSON.stringify(setup))});
    `);
    await page.goto(`${BASE}/duel/play`);
    let activated = false;
    let found = false;
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const state = await page.evaluate(`
        const d = [...document.querySelectorAll('[role="dialog"]')].find(e => e.offsetParent !== null && /posição de batalha/.test(e.getAttribute("aria-label") ?? ""));
        if (d) return { position: true, images: [...d.querySelectorAll("img")].map(i => i.src), preview: document.querySelector("[data-preview-owner] img")?.src };
        return { position: false };
      `);
      if (state.position) {
        assert(state.images.some(src => src.includes(String(c.monster))), `${c.name}: imagem do monstro na decisão`);
        assert(state.preview?.includes(String(c.monster)), `${c.name}: leitura lateral mostra o monstro`);
        mkdirSync(".cache/shots", { recursive: true });
        const { data } = await page.screenshot();
        writeFileSync(`.cache/shots/position-${c.name}.png`, Buffer.from(data, "base64"));
        assert(await page.clickAction("Defesa"), `${c.name}: pode escolher defesa`);
        found = true;
        break;
      }
      if (!activated) {
        const clicked = await page.evaluate(`
          const z = [...document.querySelectorAll('[data-zone^="0:2:"]')].find(e => e.querySelector('img')?.src.includes('${c.spell}') && e.querySelector('.tf-slot-active'));
          z?.querySelector('[role="button"]')?.click(); return Boolean(z);
        `);
        if (clicked) { await delay(100); activated = await page.clickAction("Ativar"); }
      } else {
        await page.evaluate(`
          const buttons = [...document.querySelectorAll('button')].filter(b => !b.disabled && b.offsetParent !== null);
          const confirm = buttons.find(b => /^(Confirmar|Concluir|Não responder)/.test(b.innerText.trim()));
          const place = document.querySelector('.tf-slot-place');
          const pick = [...document.querySelectorAll('[data-picker-card]:not(.md-tile-picked)')].find(e => e.offsetParent !== null);
          const fieldPick = document.querySelector('.tf-slot-active:not(.tf-slot-picked)');
          if (confirm) confirm.click();
          else if (place) place.click();
          else if (pick) pick.click();
          else if (fieldPick) fieldPick.click();
        `);
      }
      await delay(160);
    }
    if (!found) console.log(await page.evaluate(`return document.body.innerText.slice(-5000);`));
    assert(found, `${c.name}: chegou à escolha de posição`);
    console.log(`✓ ${c.name}: imagem, descrição lateral e escolha de defesa`);
  }
  assert.equal(page.errors.length, 0, page.errors.join("\n"));
} finally {
  child.kill();
}
