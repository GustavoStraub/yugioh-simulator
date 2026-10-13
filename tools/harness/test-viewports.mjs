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

/**
 * Os dois formatos: a mesa TCG tem a fileira das Zonas Extra e é a que mais
 * aperta na vertical; a Goat, a de 2005.
 */
const FORMATOS = ["goat", "tcg"];

function deck(formato) {
  const arquivo = formato === "tcg" ? "src/data/preset-decks-tcg.json" : "src/data/preset-decks.json";
  const presets = JSON.parse(readFileSync(join(REPO, arquivo), "utf8"));
  const preset = presets.find((p) => p.id === "tcg-lavd-odd-eyes") ?? presets[0];
  const agrupar = (lista) => {
    const contagem = new Map();
    for (const code of lista) contagem.set(code, (contagem.get(code) ?? 0) + 1);
    return [...contagem].map(([passcode, quantity]) => ({ passcode, quantity }));
  };
  return {
    id: "vp", name: "VP", format: formato,
    main: agrupar(preset.main), extra: agrupar(preset.extra ?? []),
    side: [], updatedAt: "2026-01-01T00:00:00.000Z",
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
    // Peça da mesa (zona, pilha) por baixo de um dos trilhos — leitura da
    // carta à esquerda, fases + histórico à direita. Rolagem não acusa isso:
    // a mesa estoura PARA DENTRO dos trilhos, e a trilha de fases (z-50)
    // tampava a coluna de Extra/Cemitério/Deck numa janela de 1024.
    sobreposicoes: (() => {
      if (!mesa) return [];
      const trilhos = [...mesa.querySelectorAll("aside")].map((a) => a.getBoundingClientRect());
      const cruza = (a, b) =>
        a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
      return [...mesa.querySelectorAll("[data-zone], [data-pile]")]
        .filter((el) => !el.closest("aside"))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0 && trilhos.some((t) => cruza(r, t)))
        .map(({ el }) => el.dataset.zone ?? el.dataset.pile);
    })(),
  };
`;

async function abrirDuelo(page, formato = "goat") {
  await page.goto(`${BASE}/duel`);
  // O perfil vem ANTES do deck: sem nome, a portaria (`PlayerProvider`) segura
  // a aplicação na pergunta "como você quer ser chamado?" e o lobby nem
  // renderiza — sem isto o teste morria em "não iniciou o duelo".
  await page.evaluate(
    `localStorage.setItem("yugioh-goat-profile-v1", ${JSON.stringify(
      JSON.stringify({ id: "harnessviewport1", name: "Medidor" }),
    )});
     localStorage.setItem("yugioh-goat-deck-v1", ${JSON.stringify(JSON.stringify(deck(formato)))}); return true;`,
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
    for (const formato of FORMATOS) {
      for (const tela of TELAS) {
        const page = await openPage(port);
        await page.setViewport(tela.w, tela.h);
        await abrirDuelo(page, formato);

        const m = await page.evaluate(MEDIR);
        const shot = await page.screenshot();
        writeFileSync(
          join(OUT, `viewport-${formato}-${tela.nome}.png`),
          Buffer.from(shot.data, "base64"),
        );

        // A mesa ocupa a janela inteira: rolagem horizontal quer dizer layout
        // estourado, e não "tela pequena". E nenhuma peça por baixo dos trilhos.
        const ok =
          !m.rolagemHorizontal && m.mesaVisivel && m.alturaDaCarta > 40 && m.sobreposicoes.length === 0;
        if (!ok) falhas += 1;
        process.stdout.write(
          `${ok ? "OK   " : "FALHA"} ${formato.padEnd(4)} ${tela.nome.padEnd(10)} carta=${m.larguraDaCarta}x${m.alturaDaCarta} ` +
          `rolagem-h=${m.rolagemHorizontal} mesa-visível=${m.mesaVisivel} ` +
          `sob-os-trilhos=${m.sobreposicoes.length ? m.sobreposicoes.join(",") : "nenhuma"}\n`,
        );
      }
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
