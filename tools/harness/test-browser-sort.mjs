/**
 * Avanço de Carta na tela: sem o "declare um número" solto, e a ordenação
 * num prompt só — as cartas já enfileiradas na ordem do Deck, mexendo só no
 * que se quer (setas ◀ ▶ ou arrastar).
 *
 * Precisa do app rodando em APP_URL (padrão http://127.0.0.1:3000).
 * Uso: npm run test:browser-sort
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { OcgLocation } from "@n1xx1/ocgcore-wasm";

import { launchChrome, openPage } from "./browser.mjs";
import { REPO } from "./env.mjs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const OUT = join(REPO, ".cache/shots");
const CARD_ADVANCE = 52112003;
// Cinco Normais diferentes, para a ordem ser legível.
const MAIN = [5053103, 89631139, 46986414, 70781052, 91152256].flatMap((code) => Array(8).fill(code));

const setup = {
  playerName: "Testador",
  playerDeck: { main: MAIN, extra: [], side: [] },
  opponentId: "teste",
  opponentName: "Oponente",
  opponentDeck: { main: Array(40).fill(5053103), extra: [], side: [] },
  format: "tcg",
  scenario: [{ player: 0, location: OcgLocation.HAND, code: CARD_ADVANCE }],
};

const falhas = [];
function conferir(condicao, descricao, detalhe = "") {
  console.log(condicao ? `  ✓ ${descricao}` : `  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!condicao) falhas.push(descricao);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Nomes na fileira, da esquerda (topo) para a direita. */
const FILEIRA = `return [...document.querySelectorAll("[data-sort-position]")]
  .sort((a, b) => Number(a.dataset.sortPosition) - Number(b.dataset.sortPosition))
  .map((el) => el.dataset.sortCard + ":" + (el.querySelector("img")?.alt ?? "?"));`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { child, port } = await launchChrome({ headless: !process.argv.includes("--headed") });
  const page = await openPage(port);
  try {
    await page.setViewport(1440, 900);
    await page.goto(`${BASE}/duel`);
    await page.evaluate(
      `localStorage.setItem("yugioh-goat-language-v1", "en");
       localStorage.setItem("yugioh-goat-profile-v1", ${JSON.stringify(JSON.stringify({ id: "harnesssort", name: "Testador" }))});
       sessionStorage.setItem("yugioh-goat-duel-setup-v1", ${JSON.stringify(JSON.stringify(setup))});
       return true;`,
    );
    await page.goto(`${BASE}/duel/play`);

    // Clica a carta e "Ativar" no menu dela — repetindo até o menu aparecer
    // (a mão demora a ficar jogável enquanto a abertura do duelo anima).
    let ativou = false;
    for (let i = 0; i < 60 && !ativou; i += 1) {
      await sleep(400);
      const clicou = await page.evaluate(`
        const slot = [...document.querySelectorAll('[data-zone^="0:2:"]')].find((el) => /Card Advance/.test(el.querySelector("img")?.alt ?? ""));
        const alvo = slot?.querySelector('[role="button"]');
        if (!alvo) return false;
        alvo.click();
        return true;`);
      if (!clicou) continue;
      await sleep(300);
      ativou = await page.clickAction("Ativar");
    }
    conferir(ativou, "ativei o Avanço de Carta da mão");

    let abriu = false;
    let perguntouNumero = false;
    for (let i = 0; i < 60 && !abriu; i += 1) {
      await sleep(300);
      // Magia da mão: o core pergunta em que zona ela entra.
      await page.evaluate(`document.querySelector('[data-zone^="0:8:"] .tf-slot-place')?.closest('[data-zone]')?.querySelector('[role="button"]')?.click(); return true;`);
      if ((await page.evaluate(`return [...document.querySelectorAll("button")].some((b) => b.offsetParent && b.innerText.trim() === "Não responder");`))) {
        await page.clickAction("Não responder");
      }
      perguntouNumero ||= await page.evaluate(`return document.body.innerText.includes("Declare um número");`);
      abriu = await page.evaluate(`return document.querySelectorAll("[data-sort-card]").length > 0;`);
    }
    if (!abriu) writeFileSync(join(OUT, "ordenar-falhou.png"), Buffer.from((await page.screenshot()).data, "base64"));
    conferir(!perguntouNumero, "nenhum \"Declare um número\" apareceu");
    conferir(abriu, "a ordenação abriu direto");
    const inicio = await page.evaluate(FILEIRA);
    conferir(inicio.length === 5, "com as 5 cartas do topo, já enfileiradas", JSON.stringify(inicio));
    conferir(
      await page.evaluate(`return [...document.querySelectorAll("button")].some((b) => b.innerText.includes("Confirmar ordem") && !b.disabled);`),
      "\"Confirmar ordem\" já vem habilitado (nada a numerar)",
    );

    // ▶ na 1ª carta: ela desce uma posição.
    if (!abriu) throw new Error("a ordenação não abriu — ver .cache/shots/ordenar-falhou.png");
    await page.evaluate(`document.querySelector('[data-sort-position="0"] [aria-label="Mover para baixo no Deck"]').click(); return true;`);
    await sleep(150);
    const aposSeta = await page.evaluate(FILEIRA);
    conferir(
      aposSeta[0] === inicio[1] && aposSeta[1] === inicio[0],
      "▶ troca a 1ª com a 2ª",
      JSON.stringify(aposSeta),
    );

    // Arrastar a última para o topo (eventos de arrastar do HTML).
    await page.evaluate(`
      const de = document.querySelector('[data-sort-position="4"]');
      const para = document.querySelector('[data-sort-position="0"]');
      const dt = new DataTransfer();
      de.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
      para.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      return true;`);
    await sleep(50);
    await page.evaluate(`
      const de = document.querySelector('[data-sort-position="4"]');
      const para = document.querySelector('[data-sort-position="0"]');
      const dt = new DataTransfer();
      para.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      de.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
      return true;`);
    await sleep(150);
    const aposArrastar = await page.evaluate(FILEIRA);
    conferir(
      aposArrastar[0] === aposSeta[4] && aposArrastar[1] === aposSeta[0],
      "arrastar a última para o topo a põe em 1º",
      JSON.stringify(aposArrastar),
    );
    writeFileSync(join(OUT, "ordenar-avanco.png"), Buffer.from((await page.screenshot()).data, "base64"));

    await page.clickAction("Confirmar ordem");
    let fechou = false;
    for (let i = 0; i < 30 && !fechou; i += 1) {
      await sleep(200);
      fechou = await page.evaluate(`return document.querySelectorAll("[data-sort-card]").length === 0;`);
    }
    conferir(fechou, "o core aceitou a ordem (o modal fechou)");
    await sleep(500);
    conferir(
      !(await page.evaluate(`return document.body.innerText.includes("Resposta inválida");`)),
      "sem \"Resposta inválida\"",
    );
    conferir(page.errors.length === 0, "sem exceções na página", page.errors.join(" | "));
  } finally {
    child.kill();
  }
  if (falhas.length) {
    console.log(`\n${falhas.length} falha(s).`);
    process.exitCode = 1;
  } else {
    console.log("\nOrdenação na tela: tudo certo.");
  }
}

await main();
