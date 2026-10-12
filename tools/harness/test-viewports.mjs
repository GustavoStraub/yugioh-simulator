/**
 * Confere a mesa em telas menores e com "movimento reduzido" ligado.
 *
 * As cartas do tabuleiro têm proporção fixa e crescem a partir da ALTURA da
 * fileira. Numa janela baixa elas encolhem, e a pergunta é se algo estoura:
 * rolagem horizontal, painel espremido, texto ilegível. E o realce da carta
 * acionável é feito com animação — com movimento reduzido ele precisa
 * continuar visível de forma estática, senão o jogador perde a única pista de
 * onde clicar.
 *
 * Uso: APP_URL=http://127.0.0.1:3100 node tools/harness/test-viewports.mjs
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { launchChrome, openPage } from "./browser.mjs";
import { REPO } from "./env.mjs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const OUT = join(REPO, ".cache/shots");

/** Telas de teste: notebook comum, notebook baixo, e uma janela apertada. */
const TELAS = [
  { nome: "1440x900", w: 1440, h: 900 },
  { nome: "1280x720", w: 1280, h: 720 },
  { nome: "1024x640", w: 1024, h: 640 },
];

function deck() {
  const presets = JSON.parse(readFileSync(join(REPO, "src/data/preset-decks.json"), "utf8"));
  const contagem = new Map();
  for (const code of presets[0].main) contagem.set(code, (contagem.get(code) ?? 0) + 1);
  return {
    id: "vp", name: "VP", format: "goat",
    main: [...contagem].map(([passcode, quantity]) => ({ passcode, quantity })),
    extra: [], side: [], updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const MEDIR = `
  const doc = document.documentElement;
  const mesa = document.querySelector(".tf-playmat");
  const carta = document.querySelector("[data-zone^='0:4:']");
  const realce = document.querySelector(".tf-slot-active");
  const sombra = realce ? getComputedStyle(realce).boxShadow : "";
  return {
    rolagemHorizontal: doc.scrollWidth > doc.clientWidth + 1,
    rolagemVertical: doc.scrollHeight > doc.clientHeight + 1,
    alturaDaCarta: carta ? Math.round(carta.getBoundingClientRect().height) : 0,
    larguraDaCarta: carta ? Math.round(carta.getBoundingClientRect().width) : 0,
    temRealce: Boolean(realce),
    // Com movimento reduzido a animação some; o contorno tem que ficar.
    realceVisivel: Boolean(sombra && sombra !== "none"),
    mesaVisivel: Boolean(mesa && mesa.getBoundingClientRect().height > 200),
  };
`;

async function abrirDuelo(page) {
  await page.goto(`${BASE}/duel`);
  // O perfil vem ANTES do deck: sem nome, a portaria (`PlayerProvider`) segura
  // a aplicação na pergunta "como você quer ser chamado?" e o lobby nem
  // renderiza — sem isto o teste morria em "não iniciou o duelo".
  await page.evaluate(
    `localStorage.setItem("yugioh-goat-profile-v1", ${JSON.stringify(
      JSON.stringify({ id: "harnessviewport1", name: "Medidor" }),
    )});
     localStorage.setItem("yugioh-goat-deck-v1", ${JSON.stringify(JSON.stringify(deck()))}); return true;`,
  );
  await page.goto(`${BASE}/duel`);
  for (let i = 0; i < 60; i += 1) {
    const t = await page.evaluate("return document.body.innerText");
    if (!t.includes("Carregando catálogo")) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!(await page.clickText("Iniciar duelo"))) throw new Error("não iniciou o duelo");
  await new Promise((r) => setTimeout(r, 6000));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { child, port } = await launchChrome({ headless: true });
  let falhas = 0;

  try {
    for (const tela of TELAS) {
      const page = await openPage(port);
      await page.setViewport(tela.w, tela.h);
      await abrirDuelo(page);

      const m = await page.evaluate(MEDIR);
      const shot = await page.screenshot();
      writeFileSync(join(OUT, `viewport-${tela.nome}.png`), Buffer.from(shot.data, "base64"));

      // A mesa ocupa a janela inteira: rolagem horizontal quer dizer layout
      // estourado, e não "tela pequena".
      const ok = !m.rolagemHorizontal && m.mesaVisivel && m.alturaDaCarta > 40;
      if (!ok) falhas += 1;
      process.stdout.write(
        `${ok ? "OK   " : "FALHA"} ${tela.nome.padEnd(10)} carta=${m.larguraDaCarta}x${m.alturaDaCarta} ` +
        `rolagem-h=${m.rolagemHorizontal} mesa-visível=${m.mesaVisivel}\n`,
      );
    }

    // --- movimento reduzido ---
    const page = await openPage(port);
    await page.setViewport(1440, 900);
    await page.setReducedMotion(true);
    await abrirDuelo(page);
    const m = await page.evaluate(MEDIR);
    const shot = await page.screenshot();
    writeFileSync(join(OUT, "movimento-reduzido.png"), Buffer.from(shot.data, "base64"));

    const okReduzido = m.temRealce ? m.realceVisivel : true;
    if (!okReduzido) falhas += 1;
    process.stdout.write(
      `${okReduzido ? "OK   " : "FALHA"} movimento-reduzido  ` +
      `tem-realce=${m.temRealce} realce-visível=${m.realceVisivel}\n`,
    );

    process.stdout.write(`\nfalhas: ${falhas}\nfotos em ${OUT}\n`);
    if (falhas > 0) process.exitCode = 1;
  } finally {
    child.kill();
  }
}

await main();
