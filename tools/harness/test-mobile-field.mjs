/** Mesa cheia: proporções de cartas, números, marcadores e hologramas no toque. */
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO } from "./env.mjs";

const moduleUrl = process.env.PLAYWRIGHT_MODULE ?? pathToFileURL(join(REPO, ".cache/mobile-webkit/node_modules/playwright/index.mjs")).href;
const { chromium, webkit } = await import(moduleUrl);
const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const OUT = join(REPO, ".cache/shots/mobile");
mkdirSync(OUT, { recursive: true });
const monsters = [46986414, 89631139, 91152256, 40640057, 69140098];
const scenario = [
  ...monsters.flatMap((code, sequence) => [0, 1].map((player) => ({ player, location: 4, sequence, code, position: (sequence + player) % 2 ? 4 : 1 }))),
  ...Array.from({ length: 5 }, (_, sequence) => [0, 1].map((player) => ({ player, location: 8, sequence, code: 44095762, position: 8 }))).flat(),
  ...monsters.map((code) => ({ player: 0, location: 2, code })),
];
const sizes = [[568,320], [667,375], [844,390], [844,300], [932,430], [1024,768], [1440,900]];

for (const [engine, type] of [["chrome", chromium], ["webkit", webkit]]) {
  const profile = `harness-proportion-${engine}-${process.pid}`;
  const browser = await type.launch(engine === "chrome" ? { executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" } : {});
  try {
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
    await context.addInitScript((profile) => {
      localStorage.setItem("yugioh-goat-profile-v1", JSON.stringify({ id: profile, name: profile }));
      localStorage.setItem("yugioh-goat-tips-v1", JSON.stringify({ off: true, seen: [] }));
      localStorage.setItem("yugioh-goat-duel-prefs-v1", JSON.stringify({ speed: "faster", cutIns: false, holograms: "always" }));
    }, profile);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(BASE);
    for (const format of ["goat", "tcg"]) {
      const deck = { main: Array(40).fill(91152256), extra: [], side: [] };
      await page.evaluate((setup) => sessionStorage.setItem("yugioh-goat-duel-setup-v1", JSON.stringify(setup)), {
        playerName: "Mobile", opponentName: "Bot", opponentId: "proportion-test", format, playerDeck: deck, opponentDeck: deck, scenario,
      });
      await page.goto(`${BASE}/duel/play`);
      await page.waitForFunction(() => document.querySelectorAll("[data-holo-for][data-holo-on='1']").length === 10);
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height });
        await page.waitForFunction((width) => document.querySelector(".md-duel").classList.contains(width === 1440 ? "md-wide" : "md-landscape"), width);
        await page.locator('[data-zone="0:4:0"] .tf-touch-card').tap();
        await page.touchscreen.tap(width - 3, height - 3);
        // O tamanho e a chegada das cartas têm transição; medir depois de pousarem.
        await page.waitForTimeout(650);
        const metrics = await page.evaluate(() => {
          const field = document.querySelector(".md-field").getBoundingClientRect();
          const compact = Boolean(document.querySelector(".md-narrow"));
          const intersects = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
          const labels = [...document.querySelectorAll("[data-stats-for]")];
          const tagLabels = [...document.querySelectorAll("[data-tags-for]")];
          const overlap = (list) => list.some((a, i) => list.slice(i + 1).some((b) => intersects(a.getBoundingClientRect(), b.getBoundingClientRect())));
          const holograms = [...document.querySelectorAll("[data-holo-for][data-holo-on='1']")];
          const reader = document.querySelector("[data-landscape-reader]")?.getBoundingClientRect();
          const controls = [...document.querySelectorAll(".md-hud-buttons button, [data-phase-button]")];
          const cards = [...document.querySelectorAll("[data-card-position]")];
          const hand = [...document.querySelectorAll('[data-hand="0"] > [data-zone]')];
          const squareZones = cards.every((el) => Math.abs(el.offsetWidth - el.offsetHeight) <= 1);
          const sameCardSize = cards.every((el) => {
            const face = el.querySelector(".md-card-face");
            const rotation = new DOMMatrix(getComputedStyle(face).transform);
            const turned = el.dataset.cardPosition === "defense";
            return Math.abs(face.offsetWidth / face.offsetHeight - 59 / 86) < 0.05 && Math.abs(Math.hypot(rotation.a, rotation.b) - 1) < 0.01 && (turned ? Math.abs(rotation.b) > 0.99 : Math.abs(rotation.b) < 0.01);
          });
          return {
            count: holograms.length,
            statsOverlap: overlap(labels),
            tagsOverlap: overlap(tagLabels),
            bounded: holograms.every((el) => {
              const r = el.getBoundingClientRect();
              const zone = document.querySelector(`[data-zone="${el.dataset.holoFor}"] .md-card-plane`).getBoundingClientRect();
              return r.left >= field.left - 1 && r.right <= field.right + 1 && r.top >= field.top - 1 && r.bottom <= field.bottom + 1 && r.width <= zone.width * (compact ? 1.13 : 1.25);
            }),
            reader: !compact || Boolean(document.querySelector("[data-landscape-reader] img")),
            noPopup: !document.querySelector("[data-card-sheet]"),
            noOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
            touchable: getComputedStyle(document.querySelector(".md-holo-layer")).pointerEvents === "none",
            readerWidth: reader?.width ?? 0,
            fieldWidth: field.width,
            cardHeight: document.querySelector('[data-zone="0:4:0"] .md-card-plane').getBoundingClientRect().height,
            controlsFit: controls.every((el) => {
              const r = el.getBoundingClientRect();
              return r.width >= 44 && r.height >= 44 && r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1 && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
            }),
            fullscreenInHud: Boolean(document.querySelector(".md-hud-buttons [data-fullscreen-toggle]")),
            squareZones,
            sameCardSize,
            handHeight: hand[0].offsetHeight,
            handFits: hand.length >= 10 && hand.every((el) => {
              const r = el.getBoundingClientRect();
              return r.left >= field.left - 1 && r.right <= field.right + 1;
            }),
          };
        });
        await page.screenshot({ path: join(OUT, `${engine}-${format}-${width}x${height}-full-field.png`) });
        assert.equal(metrics.count, 10, "cinco hologramas de cada lado");
        assert(!metrics.statsOverlap && !metrics.tagsOverlap, `números e marcadores separados: ${JSON.stringify(metrics)}`);
        assert(metrics.bounded && metrics.touchable && metrics.reader && metrics.noPopup && metrics.noOverflow, `campo proporcional e utilizável: ${JSON.stringify(metrics)}`);
        assert(metrics.readerWidth <= width * (width < 667 ? 0.28 : 0.24), "leitura compacta deixa mais espaço para o campo");
        assert(metrics.controlsFit && metrics.fullscreenInHud, `todos os controles alcançáveis, incluindo tela cheia: ${JSON.stringify(metrics)}`);
        assert(metrics.squareZones && metrics.sameCardSize, `zonas quadradas, cartas do mesmo tamanho em ataque e defesa: ${JSON.stringify(metrics)}`);
        assert(metrics.handFits, `mão cheia cabe sem reduzir as cartas: ${JSON.stringify(metrics)}`);
        // Referência antes do ajuste: TCG 50px / Goat 58px em 844×390.
        if (width === 844 && height === 390) {
          assert(metrics.cardHeight >= (format === "tcg" ? 62 : 72), `cartas cresceram com a nova proporção: ${JSON.stringify(metrics)}`);
          assert(metrics.handHeight >= 88 && metrics.handHeight > metrics.cardHeight * 1.2, "cartas da mão maiores que as do campo");
        }
        console.log(`OK ${engine} ${format} ${width}×${height}: leitor ${Math.round(metrics.readerWidth)}px, campo ${Math.round(metrics.fieldWidth)}px, carta ${Math.round(metrics.cardHeight)}px; 10 hologramas e controles sem sobreposição`);
      }
      // Cada carta continua consultável mesmo com dez na mão sobrepostas.
      for (const [width, height] of [[568,320], [844,390]]) {
        await page.setViewportSize({ width, height });
        await page.waitForFunction(() => Boolean(document.querySelector(".md-landscape")));
        await page.waitForTimeout(300);
        const hand = page.locator('[data-hand="0"] > [data-zone]');
        const count = await hand.count();
        for (let i = 0; i < count; i++) {
          await page.touchscreen.tap(width - 3, height - 3);
          await page.locator("[data-card-menu]").waitFor({ state: "detached" });
          await page.waitForTimeout(180);
          const target = await hand.nth(i).evaluate((el) => {
            const r = el.getBoundingClientRect();
            // Mede a faixa exposta real: o giro e o realce podem cobrir parte
            // de uma carta vizinha, especialmente nas duas pontas da mão.
            let best = null;
            for (let y = Math.max(8, r.top + 8); y < Math.min(innerHeight - 8, r.bottom - 8); y += 6) {
              let first = null;
              for (let x = Math.max(4, r.left + 4); x <= Math.min(innerWidth - 4, r.right - 4); x += 2) {
                const hit = el.contains(document.elementFromPoint(x, y));
                if (hit && first === null) first = x;
                if ((!hit || x + 2 > r.right - 4) && first !== null) {
                  const width = x - first;
                  if (!best || width > best.width) best = { x: first + width / 2, y, width };
                  first = null;
                }
              }
            }
            return best ? { ...best, name: el.querySelector("img").alt } : null;
          });
          assert(target && target.width >= 8, `carta ${i} tem faixa exposta para toque em ${engine} ${width}×${height}`);
          await page.touchscreen.tap(target.x, target.y);
          await page.waitForFunction((name) => document.querySelector("[data-landscape-reader] h4")?.textContent === name, target.name, { timeout: 3000 }).catch(async (error) => {
            await page.screenshot({ path: join(OUT, "failure-hand-touch.png") });
            console.log({ engine, format, width, height, i, target, actual: await page.locator("[data-landscape-reader] h4").textContent(), hit: await page.evaluate(({x,y}) => document.elementFromPoint(x,y)?.closest("[data-zone]")?.dataset.zone, target) });
            throw error;
          });
        }
        await page.touchscreen.tap(width - 3, height - 3);
        console.log(`OK ${engine} ${format} ${width}×${height}: ${count} cartas da mão acessíveis por toque`);
      }
      // Troca de posição pelo motor real: só o giro muda, o tamanho permanece.
      for (const [width, height, sequence, expected] of [[844,390,0,"defense"], [1440,900,1,"attack"]]) {
        await page.setViewportSize({ width, height });
        await page.waitForFunction((width) => document.querySelector(".md-duel").classList.contains(width === 1440 ? "md-wide" : "md-landscape"), width);
        const target = page.locator(`[data-zone="0:4:${sequence}"]`);
        const before = await target.locator(".md-card-face").evaluate((el) => [el.offsetWidth, el.offsetHeight]);
        await target.locator(".tf-touch-card").tap();
        await page.locator('[data-command="position"]').tap();
        await page.waitForFunction(({ sequence, expected }) => document.querySelector(`[data-zone="0:4:${sequence}"]`)?.dataset.cardPosition === expected, { sequence, expected });
        await page.waitForTimeout(300);
        const after = await target.locator(".md-card-face").evaluate((el) => [el.offsetWidth, el.offsetHeight]);
        assert.deepEqual(after, before, "mudar posição mantém largura e altura da carta");
        console.log(`OK ${engine} ${format}: mudança real para ${expected}, sem encolher a carta`);
      }
    }
    await page.locator("[data-duel-settings]").tap();
    await page.locator('[data-hologram-mode="off"]').tap();
    await page.waitForFunction(() => document.querySelectorAll("[data-holo-for]").length === 0);
    await page.locator('[data-hologram-mode="always"]').tap();
    await page.waitForFunction(() => document.querySelectorAll("[data-holo-for][data-holo-on='1']").length === 10);
    assert.equal(errors.length, 0, errors.join("; "));
    console.log(`OK ${engine}: preferência de hologramas respeitada; sem erros JavaScript`);
  } finally {
    await browser.close();
    rmSync(join(REPO, ".data/decks", `${profile}.json`), { force: true });
  }
}
