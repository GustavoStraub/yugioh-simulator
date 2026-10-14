/**
 * Tira uma foto do duelo em andamento.
 *
 * Ler o DOM diz se a tela *funciona*; só olhando dá para dizer se ela está
 * boa. Salva PNGs em `.cache/shots/`.
 *
 * Uso: APP_URL=http://127.0.0.1:3100 node tools/harness/screenshot.mjs [n]
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { FASES_DISPONIVEIS, launchChrome, openPage } from "./browser.mjs";
import { REPO } from "./env.mjs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const OUT = join(REPO, ".cache/shots");

function deckDoJogador() {
  const presets = JSON.parse(readFileSync(join(REPO, "src/data/preset-decks.json"), "utf8"));
  const preset = presets[0];
  const contagem = new Map();
  for (const code of preset.main) contagem.set(code, (contagem.get(code) ?? 0) + 1);
  return {
    id: "shot", name: preset.namePt ?? preset.name, format: "goat",
    main: [...contagem].map(([passcode, quantity]) => ({ passcode, quantity })),
    extra: [], side: [], updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const quantas = Number(process.argv[2] ?? 4);
mkdirSync(OUT, { recursive: true });

const { child, port } = await launchChrome({ headless: true });
try {
  const page = await openPage(port);
  await page.goto(`${BASE}/duel`);
  // O perfil vem ANTES do deck: sem nome, a portaria (`PlayerProvider`) segura
  // a aplicação na pergunta "como você quer ser chamado?" e o lobby nem
  // renderiza — era o que fazia este script sair com zero fotos.
  await page.evaluate(
    `localStorage.setItem("yugioh-goat-profile-v1", ${JSON.stringify(
      JSON.stringify({ id: "harnessshots0001", name: "Fotógrafo" }),
    )});
     localStorage.setItem("yugioh-goat-deck-v1", ${JSON.stringify(JSON.stringify(deckDoJogador()))});
     return true;`,
  );
  await page.goto(`${BASE}/duel`);
  for (let i = 0; i < 60; i += 1) {
    const t = await page.evaluate("return document.body.innerText");
    if (!t.includes("Carregando catálogo")) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  await page.clickText("Iniciar duelo");

  let tiradas = 0;
  let acoes = 0;
  while (tiradas < quantas && acoes < 150) {
    const estado = await page.evaluate(`
      const mesa = document.querySelector(".tf-playmat") ?? document.body;
      const util = (b) => !b.disabled && b.offsetParent !== null && !b.closest("[data-table-control]") && !b.innerText.includes("\\u{1F50A}") && !b.closest('[aria-label="Idioma das cartas"]');
      return {
        botoes: [...document.querySelectorAll("button")].filter(util).map((b) => b.innerText.trim()).filter(Boolean).concat(${FASES_DISPONIVEIS}),
        cartas: document.querySelectorAll(".tf-slot-active").length,
        emCampo: document.querySelectorAll("[data-zone] img").length,
        pronto: /Main Phase|Battle Phase/.test(mesa.innerText),
      };
    `);

    // Espera haver alguma coisa em campo — uma foto da mesa vazia não diz nada.
    if (estado.pronto && estado.emCampo >= 4) {
      const shot = await page.screenshot();
      writeFileSync(join(OUT, `duelo-${tiradas + 1}.png`), Buffer.from(shot.data, "base64"));
      process.stdout.write(`foto ${tiradas + 1}: ${estado.emCampo} cartas visíveis\n`);
      tiradas += 1;
    }

    if (estado.cartas > 0) {
      await page.evaluate(`const c=[...document.querySelectorAll(".tf-slot-active")]; if(c.length) c[0].click(); return true;`);
      await new Promise((r) => setTimeout(r, 200));
      // Sem os controles da mesa: o glossário da leitura também é botão.
      const depois = await page.evaluate(`return [...document.querySelectorAll("button")].filter(b=>!b.disabled&&b.offsetParent&&!b.closest("[data-table-control]")).map(b=>b.innerText.trim()).filter(Boolean)`);
      const alvo = depois.find((b) => /^(Invocar|Ativar|Atacar|Baixar|Confirmar)/.test(b));
      if (alvo) await page.clickAction(alvo);
    } else {
      const alvo = estado.botoes.find((b) => /^(Invocar|Ativar|Atacar|Confirmar)/.test(b))
        ?? estado.botoes.find((b) => b === "BP" || b === "EP");
      if (alvo) await page.clickAction(alvo);
    }
    acoes += 1;
    await new Promise((r) => setTimeout(r, 400));
  }
  process.stdout.write(`${tiradas} foto(s) em ${OUT}\n`);
} finally {
  child.kill();
}
