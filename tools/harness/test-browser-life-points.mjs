/** #9: dano/cura no campo correto, pela perspectiva dos dois assentos. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { OcgLocation } from "@n1xx1/ocgcore-wasm";
import { launchChrome, openPage } from "./browser.mjs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3100";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const spells = [
  { code: 45311864, flashes: [["opponent", "damage", "−500"], ["player", "recover", "+500"]] },
  { code: 46918794, flashes: [["opponent", "damage", "−1000"], ["player", "damage", "−500"]] },
  { code: 70368879, flashes: [["opponent", "recover", "+1000"]] },
];
const { child, port } = await launchChrome({ headless: !process.argv.includes("--headed") });
try {
  const page = await openPage(port);
  await page.goto(`${BASE}/duel`);
  for (const [me, width, height] of [[0, 1440, 900], [1, 1440, 900], [0, 390, 844], [1, 844, 390]]) {
    await page.setViewport(width, height, { mobile: width < 1000, touch: width < 1000 });
    const setup = {
      playerName: "Teste LP", opponentName: "Oponente", opponentId: "teste", format: "tcg", humanSeat: me,
      playerDeck: { main: Array(40).fill(25833572), extra: [], side: [] },
      opponentDeck: { main: Array(40).fill(25833572), extra: [], side: [] },
      // Scenario usa 0 para o humano; a sessão o converte ao assento real.
      scenario: spells.map(({ code }) => ({ player: 0, location: OcgLocation.HAND, code })),
    };
    await page.evaluate(`
      localStorage.setItem('yugioh-goat-profile-v1', JSON.stringify({ id: 'harnesslifepoints', name: 'Teste LP' }));
      localStorage.setItem('yugioh-goat-duel-prefs-v1', JSON.stringify({ holograms: 'off' }));
      localStorage.setItem('yugioh-goat-tips-v1', JSON.stringify({ off: true, seen: [] }));
      sessionStorage.setItem('yugioh-goat-duel-setup-v1', ${JSON.stringify(JSON.stringify(setup))});
    `);
    await page.goto(`${BASE}/duel/play`);
    for (const spell of spells) {
      let activated = false;
      let found = false;
      const seen = new Map();
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        const flashes = await page.evaluate(`
          const field = document.querySelector('[data-field]');
          const bounds = field?.getBoundingClientRect();
          return [...document.querySelectorAll('[data-flash]')].map(el => {
            const layer = el.closest('[data-flash-anchor]');
            const r = layer.getBoundingClientRect();
            const side = layer.dataset.flashAnchor;
            const seat = side === 'player' ? ${me} : ${1 - me};
            const z = field?.querySelector('[data-zone="' + seat + ':8:2"]')?.getBoundingClientRect();
            return {
              side, kind: el.dataset.flash, text: el.textContent,
              inField: layer.parentElement === field,
              centered: z && Math.abs(r.left + r.width / 2 - z.left - z.width / 2) < 2 && Math.abs(r.top + r.height / 2 - z.top - z.height / 2) < 2,
              correctHalf: bounds && (side === 'player' ? r.top > bounds.top + bounds.height / 2 : r.bottom < bounds.top + bounds.height / 2),
              visible: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
            };
          });
        `);
        for (const f of flashes) seen.set(`${f.side}:${f.text}`, f);
        const observed = [...seen.values()];
        if (spell.flashes.every(([side, kind, text]) => observed.some(f => f.side === side && f.kind === kind && f.text === text))) {
          for (const [side, kind, text] of spell.flashes) {
            const f = observed.find(f => f.side === side && f.kind === kind && f.text === text);
            assert(f.inField && f.centered && f.correctHalf && f.visible, JSON.stringify(f));
          }
          await delay(200);
          mkdirSync('.cache/shots', { recursive: true });
          writeFileSync(`.cache/shots/lp-${me}-${width}-${spell.code}.png`, Buffer.from((await page.screenshot()).data, 'base64'));
          found = true;
          break;
        }
        if (!activated) {
          const selected = await page.evaluate(`
            const z = [...document.querySelectorAll('[data-zone^="${me}:2:"]')].find(e => e.querySelector('img')?.src.includes('${spell.code}') && e.querySelector('.tf-slot-active'));
            z?.querySelector('[role="button"]')?.click(); return Boolean(z);
          `);
          if (selected) { await delay(80); activated = await page.clickAction('Ativar'); }
        } else {
          await page.evaluate(`document.querySelector('.tf-slot-place')?.click(); return true;`);
        }
        await delay(80);
      }
      if (!found) console.log({ activated, seen: [...seen.values()], text: await page.evaluate(`return document.body.innerText.slice(-4000);`) });
      assert(found, `assento ${me}, ${width}×${height}, carta ${spell.code}: feedback observado`);
    }
    console.log(`✓ assento ${me}, ${width}×${height}: dano e cura nos dois lados, centrados na perspectiva da mesa`);
  }
  assert.equal(page.errors.length, 0, page.errors.join('\n'));
} finally {
  child.kill();
}
